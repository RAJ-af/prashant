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
        const page = await pdfDoc.getPage(i);
        const viewport = page.getViewport({ scale: pdfScale });

        const pageContainer = document.createElement('div');
        pageContainer.className = 'page-container';
        pageContainer.dataset.pageNumber = i;
        pageContainer.innerHTML = \`<div class="page-status">Reading page \${i}...</div>\`;

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        // We need a wrapper for the canvas and highlights to handle scaling correctly
        const canvasWrapper = document.createElement('div');
        canvasWrapper.className = 'canvas-wrapper';
        canvasWrapper.style.position = 'relative';
        canvasWrapper.style.width = 'fit-content';

        canvasWrapper.appendChild(canvas);
        pageContainer.appendChild(canvasWrapper);
        pdfViewer.appendChild(pageContainer);

        await page.render({ canvasContext: context, viewport: viewport }).promise;

        const textContent = await page.getTextContent();
        let combinedString = "";
        textContent.items.forEach(item => {
            combinedString += item.str + " ";
        });

        pageTextData[i] = {
            items: textContent.items,
            combinedString: combinedString
        };

        processPageText(i, combinedString, pageContainer, viewport);
    }
}

async function processPageText(pageNum, text, container, viewport) {
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

        console.log(\`DEBUG: Page \${pageNum} highlights:\`, highlights);
        applyHighlightsToPage(pageNum, highlights, container, viewport);

    } catch (err) {
        console.error(\`DEBUG ERROR: Page \${pageNum} AI failed:\`, err);
    } finally {
        const status = container.querySelector('.page-status');
        if (status) status.remove();
    }
}

function applyHighlightsToPage(pageNum, sentences, container, viewport) {
    if (!Array.isArray(sentences) || sentences.length === 0) return;

    const pageData = pageTextData[pageNum];
    const canvasWrapper = container.querySelector('.canvas-wrapper');

    sentences.forEach(sentence => {
        const cleanSentence = sentence.toLowerCase().trim().replace(/\\s+/g, ' ');
        if (cleanSentence.length < 5) return;

        console.log(\`DEBUG: Matching sentence: "\${cleanSentence}"\`);

        // 1. Try to find items that are part of this sentence
        let matchedItems = [];

        // Word-based scoring for items
        const targetWords = cleanSentence.split(' ').filter(w => w.length > 3);

        pageData.items.forEach(item => {
            const itemStr = item.str.toLowerCase().trim().replace(/\\s+/g, ' ');
            if (itemStr.length < 2) return;

            // Direct inclusion check
            if (cleanSentence.includes(itemStr) && itemStr.length > 3) {
                matchedItems.push(item);
            } else {
                // Word overlap check
                let matches = 0;
                targetWords.forEach(word => {
                    if (itemStr.includes(word)) matches++;
                });
                if (matches > 0 && (matches / targetWords.length > 0.3 || matches / itemStr.split(' ').length > 0.5)) {
                    matchedItems.push(item);
                }
            }
        });

        console.log(\`DEBUG: Found \${matchedItems.length} matching items for sentence\`);
        matchedItems.forEach(item => {
            createHighlightElement(canvasWrapper, viewport, item);
        });
    });
}

function createHighlightElement(wrapper, viewport, item) {
    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const highlight = document.createElement('div');
    highlight.className = 'highlight-span';
    highlight.style.position = 'absolute';

    const h = item.height * pdfScale;
    const w = item.width * pdfScale;

    highlight.style.left = tx[4] + 'px';
    highlight.style.top = (tx[5] - h) + 'px';
    highlight.style.width = w + 'px';
    highlight.style.height = (h * 1.1) + 'px';
    highlight.style.pointerEvents = 'none';
    highlight.style.zIndex = '10';

    wrapper.appendChild(highlight);
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
    timerDisplay.textContent = \`\${mins.toString().padStart(2, '0')}:\${secs.toString().padStart(2, '0')}\`;
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
