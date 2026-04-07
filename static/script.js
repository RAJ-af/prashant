// PDF.js configuration
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

let pdfDoc = null;
let pdfScale = 1.5;
let pageTextData = {};

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
        const typedarray = new Uint8Array(this.result);
        try {
            pdfDoc = await pdfjsLib.getDocument(typedarray).promise;
            console.log("DEBUG: PDF loaded, num pages:", pdfDoc.numPages);
            await renderAndProcessPDF();
        } catch (err) {
            console.error("DEBUG ERROR: Failed to load PDF:", err);
            alert("Error loading PDF. Please try again.");
        } finally {
            loadingOverlay.classList.add('hidden');
        }
    };
    reader.readAsArrayBuffer(file);
}

async function renderAndProcessPDF() {
    pdfViewer.innerHTML = '';

    // Calculate scale
    const containerWidth = pdfViewer.clientWidth - 40;
    const firstPage = await pdfDoc.getPage(1);
    const originalViewport = firstPage.getViewport({ scale: 1 });
    pdfScale = Math.max(1.5, Math.min(2.5, (containerWidth / originalViewport.width) * 1.5));

    console.log("DEBUG: Starting page-by-page processing...");

    for (let i = 1; i <= pdfDoc.numPages; i++) {
        // 1. Render Page
        const page = await pdfDoc.getPage(i);
        const viewport = page.getViewport({ scale: pdfScale });

        const pageContainer = document.createElement('div');
        pageContainer.className = 'page-container';
        pageContainer.dataset.pageNumber = i;
        pageContainer.innerHTML = `<div class="page-status">Reading page ${i}...</div>`;

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.style.width = "100%";
        canvas.style.maxWidth = originalViewport.width * pdfScale + "px";
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        pageContainer.appendChild(canvas);
        pdfViewer.appendChild(pageContainer);

        await page.render({ canvasContext: context, viewport: viewport }).promise;

        // 2. Extract Text
        const textContent = await page.getTextContent();

        // Build a mapping for robust multi-word matching
        // pageTextData stores both raw items and a concatenated normalized string
        let combinedString = "";
        let itemMappings = [];

        textContent.items.forEach((item, index) => {
            const start = combinedString.length;
            combinedString += item.str + " ";
            const end = combinedString.length;
            itemMappings.push({ start, end, item });
        });

        pageTextData[i] = {
            items: textContent.items,
            combinedString: combinedString,
            mappings: itemMappings
        };

        // 3. Process with AI (Progressive)
        processPageText(i, combinedString, pageContainer);
    }
}

async function processPageText(pageNum, text, container) {
    if (!text.trim() || text.length < 20) {
        const status = container.querySelector('.page-status');
        if (status) status.remove();
        return;
    }

    try {
        const response = await fetch('/api/process-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text })
        });

        if (!response.ok) throw new Error("Backend error");

        const data = await response.json();
        const highlights = JSON.parse(data.highlights);

        console.log(`DEBUG: Page ${pageNum} highlights:`, highlights.length);
        applyHighlightsToPage(pageNum, highlights);

    } catch (err) {
        console.error(`DEBUG ERROR: Page ${pageNum} AI failed:`, err);
    } finally {
        const status = container.querySelector('.page-status');
        if (status) status.remove();
    }
}

function applyHighlightsToPage(pageNum, sentences) {
    if (!Array.isArray(sentences) || sentences.length === 0) return;

    const pageData = pageTextData[pageNum];
    const pageContainer = document.querySelector(`.page-container[data-pageNumber="${pageNum}"]`);

    pdfDoc.getPage(pageNum).then(page => {
        const viewport = page.getViewport({ scale: pdfScale });

        sentences.forEach(sentence => {
            const cleanSentence = sentence.toLowerCase().trim().replace(/\s+/g, ' ');
            if (cleanSentence.length < 5) return;

            // Search within the combined string for the match
            const sourceStr = pageData.combinedString.toLowerCase().replace(/\s+/g, ' ');
            const matchIndex = sourceStr.indexOf(cleanSentence);

            if (matchIndex !== -1) {
                // If we found a direct match in the combined string,
                // identify which text items overlap with this match range
                const matchStart = matchIndex;
                const matchEnd = matchIndex + cleanSentence.length;

                // Re-calculate the actual character positions in the original combinedString
                // to account for whitespace normalization if necessary
                // For simplicity, we fallback to partial matching on items if exact range mapping is too complex

                pageData.items.forEach(item => {
                    const itemStr = item.str.toLowerCase().trim().replace(/\s+/g, ' ');
                    if (itemStr.length > 2 && cleanSentence.includes(itemStr)) {
                        createHighlightElement(pageContainer, viewport, item);
                    }
                });
            } else {
                // Fallback: piece-by-piece matching if sentence is slightly modified by AI
                pageData.items.forEach(item => {
                    const itemStr = item.str.toLowerCase().trim().replace(/\s+/g, ' ');
                    if (itemStr.length > 4 && (cleanSentence.includes(itemStr) || itemStr.includes(cleanSentence))) {
                        createHighlightElement(pageContainer, viewport, item);
                    }
                });
            }
        });
    });
}

function createHighlightElement(container, viewport, item) {
    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const highlight = document.createElement('div');
    highlight.className = 'highlight-span';
    highlight.style.position = 'absolute';
    highlight.style.left = tx[4] + 'px';
    highlight.style.top = (tx[5] - (item.height * pdfScale)) + 'px';
    highlight.style.width = (item.width * pdfScale) + 'px';
    highlight.style.height = (item.height * pdfScale * 1.3) + 'px';

    const rotation = (Math.random() - 0.5) * 1.5;
    highlight.style.transform = `rotate(${rotation}deg)`;
    highlight.style.pointerEvents = 'none';
    highlight.style.zIndex = '10';

    container.appendChild(highlight);
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
