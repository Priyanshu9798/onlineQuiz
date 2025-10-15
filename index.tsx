/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Type } from "@google/genai";

// pdf.js is imported from a CDN, declare the global object
declare const pdfjsLib: any;

type Option = string;

interface MCQ {
    question: string;
    options: Option[];
    correctAnswer: Option;
    explanation?: string;
}

interface Quiz {
    id: string;
    title: string;
    questions: MCQ[];
    duration: number; // Duration in minutes
}

interface StudentResult {
    quizId: string;
    studentName: string;
    studentRoll: string;
    studentEmail: string;
    score: number;
    total: number;
    answers: (Option | null)[];
}

class QuizApp {
    private ai: GoogleGenAI;
    private currentView: string = 'login-section';
    private currentProfessor: string | null = null;
    
    // Simulated Database
    private professors: { [email: string]: string } = {};
    private quizzes: { [id: string]: Quiz } = {};
    private results: StudentResult[] = [];

    // Quiz taking state
    private activeQuiz: Quiz | null = null;
    private studentAnswers: (Option | null)[] = [];
    private currentQuestionIndex: number = 0;
    private quizTimerInterval: number | null = null;
    private reviewingResult: StudentResult | null = null;

    constructor() {
        this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.3.136/pdf.worker.mjs`;
        this.loadDataFromStorage();
        this.addEventListeners();
        
        // Bypass login and show professor dashboard by default
        this.loginAsProfessor(Object.keys(this.professors)[0]);
    }

    private loadDataFromStorage(): void {
        const storedProfessors = localStorage.getItem('quizAppProfessors');
        if (storedProfessors && Object.keys(JSON.parse(storedProfessors)).length > 0) {
            this.professors = JSON.parse(storedProfessors);
        } else {
            // Seed a default professor if none exist to make testing easier
            this.professors = { 'professor@test.com': 'password' };
            this.saveDataToStorage();
        }
        
        const storedQuizzes = localStorage.getItem('quizAppQuizzes');
        if (storedQuizzes) this.quizzes = JSON.parse(storedQuizzes);

        const storedResults = localStorage.getItem('quizAppResults');
        if (storedResults) this.results = JSON.parse(storedResults);
    }

    private saveDataToStorage(): void {
        localStorage.setItem('quizAppProfessors', JSON.stringify(this.professors));
        localStorage.setItem('quizAppQuizzes', JSON.stringify(this.quizzes));
        localStorage.setItem('quizAppResults', JSON.stringify(this.results));
    }

    private addEventListeners(): void {
        // Login toggles
        document.getElementById('show-student-login')?.addEventListener('click', () => this.toggleLoginForm(true));
        document.getElementById('show-professor-login')?.addEventListener('click', () => this.toggleLoginForm(false));
        document.getElementById('register-link')?.addEventListener('click', (e) => this.handleProfessorRegister(e));

        // Forms
        document.getElementById('student-login-form')?.addEventListener('submit', (e) => this.handleStudentLogin(e));
        document.getElementById('professor-login-form')?.addEventListener('submit', (e) => this.handleProfessorLogin(e));

        // Professor dashboard
        document.getElementById('logout-btn')?.addEventListener('click', () => this.logout());
        document.querySelectorAll('.creation-btn').forEach(btn => btn.addEventListener('click', (e) => {
            const method = (e.currentTarget as HTMLElement).dataset.method;
            if (method) this.showCreationModal(method);
        }));

        // Modal
        document.getElementById('close-modal-btn')?.addEventListener('click', () => this.closeCreationModal());
        document.querySelector('.modal-overlay')?.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.closeCreationModal();
        });

        // Quiz navigation
        document.getElementById('next-question-btn')?.addEventListener('click', () => this.navigateQuestion(1));
        document.getElementById('prev-question-btn')?.addEventListener('click', () => this.navigateQuestion(-1));
        document.getElementById('submit-quiz-btn')?.addEventListener('click', () => {
             if (this.reviewingResult) {
                this.endReviewMode();
            } else {
                this.showConfirmationModal();
            }
        });

        // Confirmation Modal Listeners
        document.getElementById('confirm-submission-btn')?.addEventListener('click', () => {
            this.closeConfirmationModal();
            this.submitQuiz();
        });
        document.getElementById('cancel-submission-btn')?.addEventListener('click', () => {
            this.closeConfirmationModal();
        });
    }

    private showView(viewId: string): void {
        document.querySelectorAll('.view').forEach(view => view.classList.add('hidden'));
        document.getElementById(viewId)?.classList.remove('hidden');
        this.currentView = viewId;
    }

    private toggleLoginForm(showStudent: boolean): void {
        document.getElementById('student-login-form')?.classList.toggle('hidden', !showStudent);
        document.getElementById('professor-login-form')?.classList.toggle('hidden', showStudent);
        document.getElementById('show-student-login')?.classList.toggle('active', showStudent);
        document.getElementById('show-professor-login')?.classList.toggle('active', !showStudent);
        this.hideError('login-error');
    }

    private showError(elementId: string, message: string): void {
        const errorEl = document.getElementById(elementId);
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.classList.remove('hidden');
        }
    }

    private hideError(elementId: string): void {
        document.getElementById(elementId)?.classList.add('hidden');
    }

    // --- AUTHENTICATION & ROLES ---
    private handleProfessorRegister(e: Event): void {
        e.preventDefault();
        const email = (document.getElementById('professor-email') as HTMLInputElement).value;
        const password = (document.getElementById('professor-password') as HTMLInputElement).value;
        if (!email || !password) {
            this.showError('login-error', 'Please enter both email and password.');
            return;
        }
        if (this.professors[email]) {
            this.showError('login-error', 'An account with this email already exists.');
            return;
        }
        this.professors[email] = password; // In a real app, hash the password!
        this.saveDataToStorage();
        this.loginAsProfessor(email);
    }

    private handleProfessorLogin(e: Event): void {
        e.preventDefault();
        const email = (document.getElementById('professor-email') as HTMLInputElement).value;
        const password = (document.getElementById('professor-password') as HTMLInputElement).value;
        if (this.professors[email] && this.professors[email] === password) {
            this.loginAsProfessor(email);
        } else {
            this.showError('login-error', 'Invalid email or password.');
        }
    }

    private loginAsProfessor(email: string): void {
        this.currentProfessor = email;
        this.renderProfessorDashboard();
        this.showView('professor-dashboard');
    }

    private logout(): void {
        this.currentProfessor = null;
        this.showView('login-section');
    }

    private handleStudentLogin(e: Event): void {
        e.preventDefault();
        const code = (document.getElementById('student-quiz-code') as HTMLInputElement).value.toUpperCase();
        const name = (document.getElementById('student-name') as HTMLInputElement).value;
        const roll = (document.getElementById('student-roll') as HTMLInputElement).value;
        const email = (document.getElementById('student-email') as HTMLInputElement).value;

        if (!code || !name || !roll || !email) {
            this.showError('login-error', 'Please fill in all fields.');
            return;
        }

        const quiz = this.quizzes[code];
        if (quiz) {
            localStorage.setItem('currentStudentInfo', JSON.stringify({ name, roll, email }));
            this.startQuiz(quiz);
        } else {
            this.showError('login-error', 'Invalid quiz code.');
        }
    }

    // --- PROFESSOR DASHBOARD & QUIZ CREATION ---

    private renderProfessorDashboard(): void {
        const quizList = document.getElementById('quiz-list');
        if (!quizList) return;
        quizList.innerHTML = '';
        const professorQuizzes = Object.values(this.quizzes).reverse();
        if (professorQuizzes.length === 0) {
            quizList.innerHTML = '<p>You have not created any quizzes yet.</p>';
            return;
        }

        professorQuizzes.forEach(quiz => {
            const quizItem = document.createElement('div');
            quizItem.className = 'quiz-list-item';
            quizItem.innerHTML = `
                <div class="quiz-info">
                    <h3>${quiz.title}</h3>
                    <p>Quiz Code: <span>${quiz.id}</span></p>
                </div>
                <div class="quiz-actions">
                    <button class="btn-secondary view-questions-btn" data-quiz-id="${quiz.id}">Questions</button>
                    <button class="view-results-btn" data-quiz-id="${quiz.id}">View Results</button>
                </div>
            `;
            quizList.appendChild(quizItem);
        });
        
        // This is inefficient, ideally use event delegation. But for this scale it's fine.
        document.querySelectorAll('.view-results-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const quizId = (e.currentTarget as HTMLElement).dataset.quizId;
                if (quizId) this.renderProfessorResults(quizId);
            });
        });
        document.querySelectorAll('.view-questions-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const quizId = (e.currentTarget as HTMLElement).dataset.quizId;
                if (quizId) this.renderProfessorQuizReview(quizId);
            });
        });
    }

    private showCreationModal(method: string): void {
        const modalBody = document.getElementById('modal-body');
        if (!modalBody) return;

        let content = '';
        switch(method) {
            case 'manual':
                content = `
                    <h3>Create Quiz Manually</h3>
                    <form id="manual-quiz-form">
                        <input type="text" id="manual-quiz-title" placeholder="Quiz Title" required>
                        <input type="number" id="manual-quiz-duration" placeholder="Duration in minutes" min="1" required>
                        <div id="manual-questions-container"></div>
                        <button type="button" id="add-question-btn">+ Add Question</button>
                        <button type="submit">Save Quiz</button>
                    </form>
                `;
                break;
            case 'topic':
                content = `
                    <h3>Generate Quiz by Topic</h3>
                    <form id="topic-quiz-form">
                        <input type="text" id="topic-quiz-title" placeholder="Quiz Title" required>
                        <input type="text" id="quiz-topic" placeholder="e.g., 'Photosynthesis'" required>
                        <input type="number" id="quiz-num-questions" placeholder="Number of Questions (e.g., 5)" min="1" max="10" required>
                        <input type="number" id="topic-quiz-duration" placeholder="Duration in minutes" min="1" required>
                        <label for="quiz-difficulty">Difficulty:</label>
                        <select id="quiz-difficulty">
                            <option value="Easy">Easy</option>
                            <option value="Medium" selected>Medium</option>
                            <option value="Hard">Hard</option>
                        </select>
                        <button type="submit">Generate & Save</button>
                    </form>
                `;
                break;
            case 'pdf':
                content = `
                    <h3>Generate Quiz from PDF</h3>
                     <form id="pdf-quiz-form">
                        <input type="text" id="pdf-quiz-title" placeholder="Quiz Title" required>
                        <input type="number" id="pdf-quiz-duration" placeholder="Duration in minutes" min="1" required>
                        <div id="drop-zone" role="button">
                            <input type="file" id="pdf-file-input" accept=".pdf" hidden />
                            <p>Drag & drop PDF here, or click to browse</p>
                            <p id="pdf-file-name"></p>
                        </div>
                        <label for="pdf-quiz-difficulty">Difficulty:</label>
                        <select id="pdf-quiz-difficulty">
                            <option value="Easy">Easy</option>
                            <option value="Medium" selected>Medium</option>
                            <option value="Hard">Hard</option>
                        </select>
                        <button type="submit">Generate & Save</button>
                    </form>
                `;
                break;
        }
        modalBody.innerHTML = content;
        this.addModalEventListeners(method);
        document.getElementById('creation-modal')?.classList.remove('hidden');
    }

    private addModalEventListeners(method: string): void {
        if (method === 'manual') {
            document.getElementById('add-question-btn')?.addEventListener('click', () => this.addManualQuestionField());
            document.getElementById('manual-quiz-form')?.addEventListener('submit', e => { e.preventDefault(); this.saveManualQuiz(); });
            this.addManualQuestionField(); // Add the first question field
        } else if (method === 'topic') {
            document.getElementById('topic-quiz-form')?.addEventListener('submit', e => { e.preventDefault(); this.generateQuizFromTopic(); });
        } else if (method === 'pdf') {
            const dropZone = document.getElementById('drop-zone')!;
            const fileInput = document.getElementById('pdf-file-input') as HTMLInputElement;
            dropZone.addEventListener('click', () => fileInput.click());
            dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
            dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); });
            dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropZone.classList.remove('dragover');
                if (e.dataTransfer?.files[0]) fileInput.files = e.dataTransfer.files;
                this.updatePdfFileName();
            });
            fileInput.addEventListener('change', () => this.updatePdfFileName());
            document.getElementById('pdf-quiz-form')?.addEventListener('submit', e => { e.preventDefault(); this.generateQuizFromPdf(); });
        }
    }
    
    private updatePdfFileName(): void {
        const fileInput = document.getElementById('pdf-file-input') as HTMLInputElement;
        const fileNameDisplay = document.getElementById('pdf-file-name');
        if (fileNameDisplay && fileInput.files && fileInput.files.length > 0) {
            fileNameDisplay.textContent = fileInput.files[0].name;
        }
    }

    private addManualQuestionField(): void {
        const container = document.getElementById('manual-questions-container');
        if (!container) return;
        const questionIndex = container.children.length;
        const questionDiv = document.createElement('div');
        questionDiv.className = 'manual-question';
        questionDiv.style.border = '1px solid #ccc';
        questionDiv.style.padding = '1rem';
        questionDiv.style.marginTop = '1rem';
        questionDiv.style.borderRadius = '8px';

        questionDiv.innerHTML = `
            <h4>Question ${questionIndex + 1}</h4>
            <textarea placeholder="Question text" class="manual-q-text" required></textarea>
            <div class="manual-options">
                ${[0,1,2,3].map(i => `
                    <div class="option-input">
                        <input type="radio" name="correct-opt-${questionIndex}" value="${i}" required>
                        <input type="text" placeholder="Option ${i + 1}" class="manual-q-option" required>
                    </div>
                `).join('')}
            </div>
        `;
        container.appendChild(questionDiv);
    }

    private async saveManualQuiz() {
        const title = (document.getElementById('manual-quiz-title') as HTMLInputElement).value;
        const durationInput = (document.getElementById('manual-quiz-duration') as HTMLInputElement).value;
        const questions: MCQ[] = [];
        const questionElements = document.querySelectorAll('.manual-question');
        
        for (let i = 0; i < questionElements.length; i++) {
            const qElem = questionElements[i];
            const question = (qElem.querySelector('.manual-q-text') as HTMLTextAreaElement).value;
            const options = Array.from(qElem.querySelectorAll('.manual-q-option')).map(opt => (opt as HTMLInputElement).value);
            const correctIndex = (qElem.querySelector(`input[name="correct-opt-${i}"]:checked`) as HTMLInputElement)?.value;

            if (!question || options.some(o => !o) || !correctIndex) {
                 this.showError('modal-error', 'Please fill all fields for every question.');
                 return;
            }
            questions.push({
                question,
                options,
                correctAnswer: options[parseInt(correctIndex)]
                // No explanation for manual questions
            });
        }
        
        const duration = parseInt(durationInput);
        if (!title || questions.length === 0 || !duration || duration < 1) {
            this.showError('modal-error', 'Please provide a title, a valid duration, and at least one question.');
            return;
        }

        this.createAndSaveQuiz(title, questions, duration);
    }
    
    private async generateQuizFromTopic() {
        const title = (document.getElementById('topic-quiz-title') as HTMLInputElement).value;
        const topic = (document.getElementById('quiz-topic') as HTMLInputElement).value;
        const numQuestions = (document.getElementById('quiz-num-questions') as HTMLInputElement).value;
        const durationInput = (document.getElementById('topic-quiz-duration') as HTMLInputElement).value;
        const difficulty = (document.getElementById('quiz-difficulty') as HTMLSelectElement).value;
        
        const duration = parseInt(durationInput);
        if (!title || !topic || !numQuestions || !duration || duration < 1) {
            this.showError('modal-error', 'Please fill all fields with valid values.');
            return;
        }

        this.setModalLoading(true, `Generating ${numQuestions} questions on ${topic}...`);
        const prompt = `Generate ${numQuestions} multiple-choice questions (MCQs) on the topic of "${topic}" with ${difficulty} difficulty. Each question must have 4 options, one correct answer, and a brief explanation for the correct answer. Provide the output in a structured JSON format.`;
        try {
            const mcqs = await this.callGeminiForMCQs(prompt);
            this.createAndSaveQuiz(title, mcqs, duration);
        } catch (error) {
            console.error(error);
            this.showError('modal-error', 'Failed to generate questions. Please try again.');
        } finally {
            this.setModalLoading(false);
        }
    }

    private async generateQuizFromPdf() {
        const title = (document.getElementById('pdf-quiz-title') as HTMLInputElement).value;
        const fileInput = document.getElementById('pdf-file-input') as HTMLInputElement;
        const durationInput = (document.getElementById('pdf-quiz-duration') as HTMLInputElement).value;
        const difficulty = (document.getElementById('pdf-quiz-difficulty') as HTMLSelectElement).value;
        const file = fileInput.files?.[0];

        const duration = parseInt(durationInput);
        if (!title || !file || !duration || duration < 1) {
            this.showError('modal-error', 'Please provide a title, a PDF file, and a valid duration.');
            return;
        }
        
        this.setModalLoading(true, 'Parsing PDF and generating questions...');
        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
            let textContent = "";
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const text = await page.getTextContent();
                textContent += text.items.map((item: any) => item.str).join(" ") + "\n";
            }
            
            const prompt = `Based on the following text from a document, please generate 5 multiple-choice questions (MCQs) with a ${difficulty} difficulty level. Each question should have 4 options, one correct answer, and a brief explanation for the correct answer. Provide the output in a structured JSON format.
            Document Text:
            ---
            ${textContent.substring(0, 15000)} 
            ---
            `;

            const mcqs = await this.callGeminiForMCQs(prompt);
            this.createAndSaveQuiz(title, mcqs, duration);

        } catch (error) {
            console.error(error);
            this.showError('modal-error', 'Failed to process PDF or generate questions.');
        } finally {
            this.setModalLoading(false);
        }
    }
    
    private async callGeminiForMCQs(prompt: string): Promise<MCQ[]> {
         const response = await this.ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  mcqs: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        question: { type: Type.STRING },
                        options: { type: Type.ARRAY, items: { type: Type.STRING } },
                        correctAnswer: { type: Type.STRING },
                        explanation: { 
                            type: Type.STRING,
                            description: "A brief explanation of why the correct answer is correct."
                        },
                      },
                      required: ["question", "options", "correctAnswer", "explanation"],
                    },
                  },
                },
                required: ["mcqs"],
              },
            },
        });
        const jsonResponse = JSON.parse(response.text);
        if (!jsonResponse.mcqs || jsonResponse.mcqs.length === 0) {
            throw new Error("API returned no questions.");
        }
        return jsonResponse.mcqs;
    }
    
    private createAndSaveQuiz(title: string, questions: MCQ[], duration: number) {
        let newQuizId: string;
        do {
            newQuizId = Math.random().toString(36).substring(2, 8).toUpperCase();
        } while (this.quizzes[newQuizId]);

        this.quizzes[newQuizId] = { id: newQuizId, title, questions, duration };
        this.saveDataToStorage();
        this.closeCreationModal();
        this.renderProfessorDashboard();
    }
    
    private closeCreationModal(): void {
        document.getElementById('creation-modal')?.classList.add('hidden');
        this.hideError('modal-error');
        this.setModalLoading(false);
    }

    private showConfirmationModal(): void {
        document.getElementById('confirmation-modal')?.classList.remove('hidden');
    }

    private closeConfirmationModal(): void {
        document.getElementById('confirmation-modal')?.classList.add('hidden');
    }
    
    private setModalLoading(isLoading: boolean, message: string = ''): void {
        document.getElementById('modal-body')!.style.display = isLoading ? 'none' : 'block';
        document.getElementById('modal-loader')!.classList.toggle('hidden', !isLoading);
        (document.getElementById('loader-message') as HTMLElement).textContent = message;
    }

    // --- STUDENT QUIZ FLOW ---
    private startQuiz(quiz: Quiz): void {
        this.activeQuiz = quiz;
        this.studentAnswers = new Array(quiz.questions.length).fill(null);
        this.currentQuestionIndex = 0;
        this.installAntiCheating();
        document.querySelector('body')?.classList.add('quiz-active');
        document.querySelector('body')?.classList.remove('review-mode');
        (document.getElementById('quiz-title') as HTMLElement).textContent = quiz.title;
        this.startTimer(quiz.duration);
        this.renderQuestion();
        this.showView('student-quiz-section');
    }
    
    private renderQuestion(): void {
        if (!this.activeQuiz) return;
        const question = this.activeQuiz.questions[this.currentQuestionIndex];
        const quizContainer = document.getElementById('quiz-container');
        if (!quizContainer) return;

        let optionsHtml = question.options.map((option, index) => `
            <li>
                <input type="radio" name="option" value="${option}" id="option${index}" ${this.studentAnswers[this.currentQuestionIndex] === option ? 'checked' : ''}>
                <label for="option${index}">${option}</label>
            </li>
        `).join('');

        quizContainer.innerHTML = `
            <div class="question-container">
                <h3>Q ${this.currentQuestionIndex + 1}/${this.activeQuiz.questions.length}: ${question.question}</h3>
                <ul class="options-list">${optionsHtml}</ul>
            </div>
        `;
        
        quizContainer.querySelectorAll('input[name="option"]').forEach(input => {
            input.addEventListener('change', (e) => {
                this.studentAnswers[this.currentQuestionIndex] = (e.target as HTMLInputElement).value;
            });
        });

        // Update navigation buttons
        (document.getElementById('prev-question-btn') as HTMLElement).classList.toggle('hidden', this.currentQuestionIndex === 0);
        (document.getElementById('next-question-btn') as HTMLElement).classList.toggle('hidden', this.currentQuestionIndex === this.activeQuiz.questions.length - 1);
        const submitBtn = document.getElementById('submit-quiz-btn') as HTMLElement;
        submitBtn.classList.toggle('hidden', this.currentQuestionIndex !== this.activeQuiz.questions.length - 1);
        submitBtn.textContent = 'Submit Quiz';
    }
    
    private navigateQuestion(direction: number): void {
        const newIndex = this.currentQuestionIndex + direction;
        if (this.activeQuiz && newIndex >= 0 && newIndex < this.activeQuiz.questions.length) {
            this.currentQuestionIndex = newIndex;
            if (this.reviewingResult) {
                this.renderReviewQuestion();
            } else {
                this.renderQuestion();
            }
        }
    }

    private submitQuiz(cheated: boolean = false, timedOut: boolean = false): void {
        if (!this.activeQuiz) return;
        
        this.stopTimer();
        this.uninstallAntiCheating();
        document.querySelector('body')?.classList.remove('quiz-active');

        let score = 0;
        this.activeQuiz.questions.forEach((q, i) => {
            if (this.studentAnswers[i] === q.correctAnswer) {
                score++;
            }
        });

        const studentInfo = JSON.parse(localStorage.getItem('currentStudentInfo') || '{}');
        const result: StudentResult = {
            quizId: this.activeQuiz.id,
            studentName: studentInfo.name,
            studentRoll: studentInfo.roll,
            studentEmail: studentInfo.email,
            score: cheated ? 0 : score,
            total: this.activeQuiz.questions.length,
            answers: this.studentAnswers
        };
        this.results.push(result);
        this.saveDataToStorage();

        this.renderStudentResult(result, cheated, timedOut);

        // Reset state
        this.activeQuiz = null;
        this.studentAnswers = [];
        this.currentQuestionIndex = 0;
        localStorage.removeItem('currentStudentInfo');
    }
    
    // --- TIMER ---
    private startTimer(durationInMinutes: number): void {
        this.stopTimer();
        const timerEl = document.getElementById('quiz-timer');
        if (!timerEl) return;
        timerEl.classList.remove('hidden');

        const endTime = Date.now() + durationInMinutes * 60 * 1000;

        const updateTimer = () => {
            const remainingMs = endTime - Date.now();
            if (remainingMs <= 0) {
                timerEl.textContent = '00:00';
                this.submitQuiz(false, true); // Submit with timedOut flag
                return;
            }

            const minutes = Math.floor((remainingMs / 1000) / 60);
            const seconds = Math.floor((remainingMs / 1000) % 60);
            timerEl.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        };
        
        updateTimer();
        this.quizTimerInterval = window.setInterval(updateTimer, 1000);
    }

    private stopTimer(): void {
        if (this.quizTimerInterval) {
            clearInterval(this.quizTimerInterval);
            this.quizTimerInterval = null;
        }
    }

    // --- ANTI-CHEATING ---
    private visibilityChangeHandler = (): void => {
        if (document.visibilityState === 'hidden') {
            this.submitQuiz(true, false);
        }
    }

    private preventCheatingHandler = (e: Event): void => e.preventDefault();
    
    private installAntiCheating(): void {
        document.addEventListener('visibilitychange', this.visibilityChangeHandler);
        document.addEventListener('contextmenu', this.preventCheatingHandler);
        document.addEventListener('copy', this.preventCheatingHandler);
        document.addEventListener('paste', this.preventCheatingHandler);
    }

    private uninstallAntiCheating(): void {
        document.removeEventListener('visibilitychange', this.visibilityChangeHandler);
        document.removeEventListener('contextmenu', this.preventCheatingHandler);
        document.removeEventListener('copy', this.preventCheatingHandler);
        document.removeEventListener('paste', this.preventCheatingHandler);
    }
    
    // --- RESULTS & REVIEW ---

    private renderStudentResult(result: StudentResult, cheated: boolean, timedOut: boolean): void {
        const resultsSection = document.getElementById('results-section');
        if (!resultsSection) return;
        
        let message = `<h1>Quiz Submitted!</h1>`;
        if (cheated) {
            message += `<p class="error-message">Your quiz was automatically submitted with a score of 0 because you switched tabs or minimized the window.</p>`;
        } else if (timedOut) {
            message += `<p class="info-message">Time's up! Your quiz has been automatically submitted.</p>`;
        }
        message += `<div class="card">
            <p>Your Score: <span>${result.score} / ${result.total}</span></p>
            <div class="result-actions">
                <button id="review-answers-btn">Review Answers</button>
                <button onclick="window.location.reload()">Back to Login</button>
            </div>
        </div>`;
        resultsSection.innerHTML = message;

        document.getElementById('review-answers-btn')?.addEventListener('click', () => {
            this.startReviewMode(result);
        });

        this.showView('results-section');
    }

    private startReviewMode(result: StudentResult): void {
        const quiz = this.quizzes[result.quizId];
        if (!quiz) return;

        this.activeQuiz = quiz;
        this.reviewingResult = result;
        this.currentQuestionIndex = 0;

        document.querySelector('body')?.classList.add('review-mode');
        (document.getElementById('quiz-title') as HTMLElement).textContent = `${quiz.title} (Review)`;
        document.getElementById('quiz-timer')?.classList.add('hidden'); // Hide timer

        this.renderReviewQuestion();
        this.showView('student-quiz-section');
    }

    private endReviewMode(): void {
        if (!this.reviewingResult) return;

        document.querySelector('body')?.classList.remove('review-mode');
        document.getElementById('quiz-timer')?.classList.remove('hidden');

        const result = this.reviewingResult;

        // Reset state
        this.activeQuiz = null;
        this.reviewingResult = null;
        this.currentQuestionIndex = 0;
        
        this.renderStudentResult(result, false, false); // Re-render the results page
    }
    
    private renderReviewQuestion(): void {
        if (!this.activeQuiz || !this.reviewingResult) return;

        const question = this.activeQuiz.questions[this.currentQuestionIndex];
        const studentAnswer = this.reviewingResult.answers[this.currentQuestionIndex];
        const correctAnswer = question.correctAnswer;
        
        const quizContainer = document.getElementById('quiz-container');
        if (!quizContainer) return;

        const optionsHtml = question.options.map((option, index) => {
            let li_class = 'option-item';
            if (option === correctAnswer) li_class += ' correct';
            
            if (option === studentAnswer) {
                li_class += ' selected';
                if (option !== correctAnswer) {
                    li_class += ' incorrect';
                }
            }
            return `<li class="${li_class}" data-option="${String.fromCharCode(65 + index)}"><label>${option}</label></li>`;
        }).join('');
        
        const explanationHtml = question.explanation 
            ? `<div class="explanation"><h4>Explanation</h4><p>${question.explanation}</p></div>` 
            : '';

        quizContainer.innerHTML = `
            <div class="question-container">
                <h3>Q ${this.currentQuestionIndex + 1}/${this.activeQuiz.questions.length}: ${question.question}</h3>
                <ul class="options-list review-list">${optionsHtml}</ul>
                ${explanationHtml}
            </div>
        `;

        // Update navigation buttons for review mode
        (document.getElementById('prev-question-btn') as HTMLElement).classList.toggle('hidden', this.currentQuestionIndex === 0);
        const isLastQuestion = this.currentQuestionIndex === this.activeQuiz.questions.length - 1;
        (document.getElementById('next-question-btn') as HTMLElement).classList.toggle('hidden', isLastQuestion);
        
        const submitBtn = document.getElementById('submit-quiz-btn') as HTMLElement;
        submitBtn.classList.remove('hidden');
        submitBtn.textContent = 'Back to Results';
    }
    
    private renderProfessorQuizReview(quizId: string): void {
        const quiz = this.quizzes[quizId];
        const reviewSection = document.getElementById('results-section'); // Reuse this section
        if (!reviewSection || !quiz) return;

        let questionsHtml = quiz.questions.map((q, index) => {
            const optionsHtml = q.options.map(option => `
                <li class="option-item ${option === q.correctAnswer ? 'correct' : ''}" data-option="${String.fromCharCode(65 + q.options.indexOf(option))}">
                    <label>${option}</label>
                </li>
            `).join('');
            
            const explanationHtml = q.explanation 
            ? `<div class="explanation"><h4>Explanation</h4><p>${q.explanation}</p></div>` 
            : '';

            return `
                <div class="card review-question-card">
                    <h4>Q ${index + 1}: ${q.question}</h4>
                    <ul class="options-list review-list">${optionsHtml}</ul>
                    ${explanationHtml}
                </div>
            `;
        }).join('');

        const content = `
            <header class="dashboard-header">
                <h1>Reviewing: ${quiz.title}</h1>
                <button id="back-to-dashboard">Back to Dashboard</button>
            </header>
            <div class="professor-review-container">
                ${questionsHtml}
            </div>
        `;

        reviewSection.innerHTML = content;
        document.getElementById('back-to-dashboard')?.addEventListener('click', () => {
            this.renderProfessorDashboard();
            this.showView('professor-dashboard');
        });
        this.showView('results-section');
    }

    private renderProfessorResults(quizId: string): void {
        const resultsSection = document.getElementById('results-section');
        const quiz = this.quizzes[quizId];
        if (!resultsSection || !quiz) return;
        const quizResults = this.results.filter(r => r.quizId === quizId);

        let content = `
            <header class="dashboard-header">
                <h1>Results for: ${quiz.title}</h1>
                <button id="back-to-dashboard">Back to Dashboard</button>
            </header>
        `;
        if (quizResults.length === 0) {
            content += `<p>No students have taken this quiz yet.</p>`;
        } else {
            content += `
                <table class="results-table">
                    <thead>
                        <tr>
                            <th>Roll Number</th>
                            <th>Name</th>
                            <th>Email</th>
                            <th>Score</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${quizResults.map(r => `
                            <tr>
                                <td>${r.studentRoll}</td>
                                <td>${r.studentName}</td>
                                <td>${r.studentEmail}</td>
                                <td>${r.score} / ${r.total}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }
        resultsSection.innerHTML = content;
        document.getElementById('back-to-dashboard')?.addEventListener('click', () => {
            this.renderProfessorDashboard();
            this.showView('professor-dashboard');
        });
        this.showView('results-section');
    }
}

new QuizApp();