// PDF.js configuration
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

let pdfDoc = null;
let pdfScale = 1.2;
let pageTextContent = {}; // Store text content per page

const pdfUpload = document.getElementById('pdf-upload');
const pdfReupload = document.getElementById('pdf-reupload');
const welcomeScreen = document.getElementById('welcome-screen');
const viewerContainer = document.getElementById('viewer-container');
const pdfViewer = document.getElementById('pdf-viewer');
const loadingOverlay = document.getElementById('loading-overlay');

// Event Listeners
pdfUpload.addEventListener('change', handleFileUpload);
pdfReupload.addEventListener('change', handleFileUpload);

async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file || file.type !== 'application/pdf') return;

    welcomeScreen.classList.add('hidden');
    viewerContainer.classList.remove('hidden');
    loadingOverlay.classList.remove('hidden');

    const reader = new FileReader();
    reader.onload = async function() {
        const typedarray = new Uint8Array(this.result);
        pdfDoc = await pdfjsLib.getDocument(typedarray).promise;
        await renderPDF();
        processPDFText();
    };
    reader.readAsArrayBuffer(file);
}

async function renderPDF() {
    pdfViewer.innerHTML = '';
    // Determine scale based on container width for responsiveness
    const containerWidth = pdfViewer.clientWidth - 40;
    const firstPage = await pdfDoc.getPage(1);
    const originalViewport = firstPage.getViewport({ scale: 1 });
    pdfScale = containerWidth / originalViewport.width;
    if (pdfScale > 1.5) pdfScale = 1.5; // Cap maximum scale

    for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const viewport = page.getViewport({ scale: pdfScale });

        const pageContainer = document.createElement('div');
        pageContainer.className = 'page-container';
        pageContainer.dataset.pageNumber = i;

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        pageContainer.appendChild(canvas);
        pdfViewer.appendChild(pageContainer);

        await page.render({ canvasContext: context, viewport: viewport }).promise;

        const textContent = await page.getTextContent();
        pageTextContent[i] = textContent.items;
    }
}

async function processPDFText() {
    let fullText = "";
    // Only process first 10 pages to keep it fast
    const maxPages = Math.min(pdfDoc.numPages, 10);
    for (let i = 1; i <= maxPages; i++) {
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        fullText += textContent.items.map(item => item.str).join(' ') + " ";
    }

    try {
        const response = await fetch('/api/process-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: fullText })
        });

        const data = await response.json();
        let sentencesToHighlight = [];
        try {
            sentencesToHighlight = JSON.parse(data.highlights);
        } catch (e) {
            // Fallback if AI didn't return perfect JSON
            sentencesToHighlight = data.highlights.split('\n').filter(s => s.trim().length > 10);
        }

        applyHighlights(sentencesToHighlight);
    } catch (err) {
        console.error("AI Highlighting failed", err);
    } finally {
        loadingOverlay.classList.add('hidden');
    }
}

function applyHighlights(sentences) {
    if (!Array.isArray(sentences)) return;

    sentences.forEach(sentence => {
        const cleanSentence = sentence.toLowerCase().trim();
        if (cleanSentence.length < 5) return;

        for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
            const items = pageTextContent[pageNum];
            if (!items) continue;

            const pageContainer = document.querySelector(`.page-container[data-pageNumber="${pageNum}"]`);

            // Use already calculated scale
            pdfDoc.getPage(pageNum).then(page => {
                const viewport = page.getViewport({ scale: pdfScale });

                items.forEach(item => {
                    if (item.str.trim().length > 2 && cleanSentence.includes(item.str.toLowerCase().trim())) {
                        const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);

                        const highlight = document.createElement('div');
                        highlight.className = 'highlight-span';
                        highlight.style.position = 'absolute';

                        // Positioning
                        highlight.style.left = tx[4] + 'px';
                        highlight.style.top = (tx[5] - (item.height * pdfScale)) + 'px';
                        highlight.style.width = (item.width * pdfScale) + 'px';
                        highlight.style.height = (item.height * pdfScale * 1.2) + 'px';

                        // Human-like effect: random slight rotation
                        const rotation = (Math.random() - 0.5) * 2; // -1 to 1 degree
                        highlight.style.transform = `rotate(${rotation}deg)`;
                        highlight.style.pointerEvents = 'none';
                        highlight.style.zIndex = '10';

                        pageContainer.appendChild(highlight);
                    }
                });
            });
        }
    });
}

// Timer Logic
const timerToggle = document.getElementById('timer-toggle');
const timerModal = document.getElementById('timer-modal');
const closeTimer = document.getElementById('close-timer');
const timerDisplay = document.getElementById('timer-display');
const startTimerBtn = document.getElementById('start-timer');
const resetTimerBtn = document.getElementById('reset-timer');

let timeLeft = 25 * 60;
let timerId = null;

timerToggle.addEventListener('click', () => timerModal.classList.remove('hidden'));
closeTimer.addEventListener('click', () => timerModal.classList.add('hidden'));

startTimerBtn.addEventListener('click', () => {
    if (timerId) {
        clearInterval(timerId);
        timerId = null;
        startTimerBtn.textContent = 'Start';
    } else {
        startTimerBtn.textContent = 'Pause';
        timerId = setInterval(() => {
            timeLeft--;
            updateTimerDisplay();
            if (timeLeft <= 0) {
                clearInterval(timerId);
                alert("Study session complete! Take a break.");
            }
        }, 1000);
    }
});

resetTimerBtn.addEventListener('click', () => {
    clearInterval(timerId);
    timerId = null;
    timeLeft = 25 * 60;
    updateTimerDisplay();
    startTimerBtn.textContent = 'Start';
});

function updateTimerDisplay() {
    const mins = Math.floor(timeLeft / 60);
    const secs = timeLeft % 60;
    timerDisplay.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// To-Do Logic
const todoToggle = document.getElementById('todo-toggle');
const todoModal = document.getElementById('todo-modal');
const closeTodo = document.getElementById('close-todo');
const todoTask = document.getElementById('todo-task');
const addTodo = document.getElementById('add-todo');
const todoList = document.getElementById('todo-list');

todoToggle.addEventListener('click', () => todoModal.classList.remove('hidden'));
closeTodo.addEventListener('click', () => todoModal.classList.add('hidden'));

addTodo.addEventListener('click', () => {
    if (todoTask.value.trim()) {
        const li = document.createElement('li');
        li.textContent = todoTask.value;
        li.onclick = () => li.classList.toggle('completed');
        todoList.appendChild(li);
        todoTask.value = '';
    }
});
