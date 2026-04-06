// PDF.js configuration
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

let pdfDoc = null;
let pdfScale = 1.5; // Base scale
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

    console.log("DEBUG: File selected:", file.name);
    welcomeScreen.classList.add('hidden');
    viewerContainer.classList.remove('hidden');
    loadingOverlay.classList.remove('hidden');

    const reader = new FileReader();
    reader.onload = async function() {
        console.log("DEBUG: File read into buffer");
        const typedarray = new Uint8Array(this.result);
        try {
            pdfDoc = await pdfjsLib.getDocument(typedarray).promise;
            console.log("DEBUG: PDF loaded, num pages:", pdfDoc.numPages);
            await renderPDF();
            processPDFText();
        } catch (err) {
            console.error("DEBUG ERROR: Failed to load PDF:", err);
            alert("Error loading PDF. Please try again.");
            loadingOverlay.classList.add('hidden');
        }
    };
    reader.readAsArrayBuffer(file);
}

async function renderPDF() {
    console.log("DEBUG: Rendering PDF...");
    pdfViewer.innerHTML = '';

    // Better scale calculation for high quality
    const containerWidth = pdfViewer.clientWidth - 40;
    const firstPage = await pdfDoc.getPage(1);
    const originalViewport = firstPage.getViewport({ scale: 1 });

    // Target a higher resolution (e.g., 2.0x device pixel ratio equivalent)
    pdfScale = (containerWidth / originalViewport.width) * 1.5;
    if (pdfScale < 1.5) pdfScale = 1.5;
    if (pdfScale > 2.5) pdfScale = 2.5;

    console.log("DEBUG: Using scale:", pdfScale);

    for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const viewport = page.getViewport({ scale: pdfScale });

        const pageContainer = document.createElement('div');
        pageContainer.className = 'page-container';
        pageContainer.dataset.pageNumber = i;

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');

        // Match CSS width to container, but internal canvas size is larger for quality
        canvas.style.width = "100%";
        canvas.style.maxWidth = originalViewport.width * pdfScale + "px";
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        pageContainer.appendChild(canvas);
        pdfViewer.appendChild(pageContainer);

        await page.render({ canvasContext: context, viewport: viewport }).promise;
        console.log(`DEBUG: Page ${i} rendered`);

        const textContent = await page.getTextContent();
        pageTextContent[i] = textContent.items;
    }
}

async function processPDFText() {
    console.log("DEBUG: Extracting text for AI...");
    let fullText = "";
    // Only process first 10 pages to keep it fast
    const maxPages = Math.min(pdfDoc.numPages, 10);
    for (let i = 1; i <= maxPages; i++) {
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        fullText += textContent.items.map(item => item.str).join(' ') + " ";
    }

    console.log(`DEBUG: Sending ${fullText.length} characters to backend`);
    try {
        const response = await fetch('/api/process-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: fullText })
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.detail || "Backend error");
        }

        const data = await response.json();
        console.log("DEBUG: Received highlights from backend:", data.highlights);

        const sentencesToHighlight = JSON.parse(data.highlights);
        console.log(`DEBUG: Applying ${sentencesToHighlight.length} highlights`);
        applyHighlights(sentencesToHighlight);
    } catch (err) {
        console.error("DEBUG ERROR: AI Highlighting failed:", err);
        alert(`Highlighting error: ${err.message}`);
    } finally {
        loadingOverlay.classList.add('hidden');
    }
}

function applyHighlights(sentences) {
    if (!Array.isArray(sentences)) return;

    sentences.forEach(sentence => {
        const cleanSentence = sentence.toLowerCase().trim().replace(/\s+/g, ' ');
        if (cleanSentence.length < 5) return;

        console.log(`DEBUG: Looking for match for sentence: "${cleanSentence.substring(0, 50)}..."`);

        for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
            const items = pageTextContent[pageNum];
            if (!items) continue;

            const pageContainer = document.querySelector(`.page-container[data-pageNumber="${pageNum}"]`);

            // Use calculated scale
            pdfDoc.getPage(pageNum).then(page => {
                const viewport = page.getViewport({ scale: pdfScale });

                items.forEach(item => {
                    const itemStr = item.str.toLowerCase().trim().replace(/\s+/g, ' ');
                    if (itemStr.length > 2 && (cleanSentence.includes(itemStr) || itemStr.includes(cleanSentence))) {
                        const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);

                        const highlight = document.createElement('div');
                        highlight.className = 'highlight-span';
                        highlight.style.position = 'absolute';

                        // Positioning based on PDF.js transform
                        highlight.style.left = tx[4] + 'px';
                        highlight.style.top = (tx[5] - (item.height * pdfScale)) + 'px';
                        highlight.style.width = (item.width * pdfScale) + 'px';
                        highlight.style.height = (item.height * pdfScale * 1.2) + 'px';

                        // Aesthetic effects
                        const rotation = (Math.random() - 0.5) * 1.5;
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

// Timer & To-Do Logic
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
                alert("Study session complete!");
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
