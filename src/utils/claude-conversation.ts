// claude.ai only keeps the messages near the viewport in the DOM, and its
// current markup no longer matches Defuddle's Claude extractor, which ends up
// skipping every assistant reply. prepareClaudeDocument returns a detached
// copy of the page with the whole transcript, reshaped so that extractor
// picks up both sides of the conversation. The live page is left untouched.

const CONVERSATION_URL_PATTERN = /^https?:\/\/claude\.ai\/(chat|share)\//;
const ROW_SELECTOR = '[data-testid="transcript-row"]';
const SIZER_SELECTOR = '[data-testid="transcript-sizer"]';
const PRINT_RENDER_TIMEOUT = 1000;
const SCROLL_COLLECT_TIMEOUT = 8000;

export function isClaudeConversation(url: string): boolean {
	return CONVERSATION_URL_PATTERN.test(url);
}

export async function prepareClaudeDocument(doc: Document): Promise<Document> {
	const clone = await cloneWithFullTranscript(doc);
	normalizeAssistantMessages(clone);
	return clone;
}

async function cloneWithFullTranscript(doc: Document): Promise<Document> {
	const sizer = doc.querySelector(SIZER_SELECTOR);
	if (!sizer || isTranscriptComplete(doc)) {
		return doc.cloneNode(true) as Document;
	}

	// claude.ai renders every row while the page is being printed, so a
	// synthetic beforeprint gives us the full transcript in a single pass.
	const win = doc.defaultView;
	if (win) {
		win.dispatchEvent(new Event('beforeprint'));
		try {
			if (await waitFor(() => isTranscriptComplete(doc), PRINT_RENDER_TIMEOUT)) {
				return doc.cloneNode(true) as Document;
			}
		} finally {
			win.dispatchEvent(new Event('afterprint'));
		}
	}

	// Otherwise scroll through the transcript and keep a copy of each row as it renders.
	const rows = await collectRowsByScrolling(doc, sizer);
	const clone = doc.cloneNode(true) as Document;
	clone.querySelectorAll(ROW_SELECTOR).forEach(row => row.remove());
	clone.querySelector(SIZER_SELECTOR)?.append(...rows.map(row => clone.importNode(row, true)));
	return clone;
}

function rowIndex(row: Element): number {
	return Number(row.getAttribute('data-index'));
}

function isTranscriptComplete(doc: Document): boolean {
	const lastRow = doc.querySelector(`${ROW_SELECTOR}[data-last-message="true"]`);
	if (!lastRow) return false;
	const rendered = new Set(Array.from(doc.querySelectorAll(ROW_SELECTOR), rowIndex));
	for (let i = 0; i <= rowIndex(lastRow); i++) {
		if (!rendered.has(i)) return false;
	}
	return true;
}

async function collectRowsByScrolling(doc: Document, sizer: Element): Promise<Element[]> {
	const rows = new Map<number, Element>();
	const collect = () => doc.querySelectorAll(ROW_SELECTOR).forEach(row => {
		const index = rowIndex(row);
		if (!Number.isNaN(index)) rows.set(index, row.cloneNode(true) as Element);
	});

	collect();
	const scroller = findScrollContainer(sizer);
	if (scroller) {
		const originalScrollTop = scroller.scrollTop;
		const deadline = Date.now() + SCROLL_COLLECT_TIMEOUT;
		scroller.scrollTop = 0;
		while (Date.now() < deadline) {
			await nextFrame();
			await nextFrame();
			collect();
			if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1) break;
			const previousScrollTop = scroller.scrollTop;
			scroller.scrollTop += Math.max(scroller.clientHeight * 0.8, 200);
			if (scroller.scrollTop === previousScrollTop) break;
		}
		scroller.scrollTop = originalScrollTop;
	}

	return Array.from(rows.entries())
		.sort(([a], [b]) => a - b)
		.map(([, row]) => row);
}

function findScrollContainer(element: Element): Element | null {
	for (let el = element.parentElement; el; el = el.parentElement) {
		const { overflowY } = getComputedStyle(el);
		if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
			return el;
		}
	}
	return element.ownerDocument.scrollingElement;
}

// Defuddle's Claude extractor reads replies from `.font-claude-response` and
// only takes the first `.standard-markdown` inside each one. Current replies
// are `[data-testid="assistant-message"]` elements whose text can be split
// across several markdown blocks (around tool calls, for example), so merge
// those blocks into the shape the extractor expects. Thinking and tool status
// sit under `[data-find-omitted]` and are left out.
function normalizeAssistantMessages(doc: Document): void {
	doc.querySelectorAll('[data-testid="assistant-message"]').forEach(message => {
		const blocks = Array.from(message.querySelectorAll('.standard-markdown')).filter(block =>
			!block.closest('[data-find-omitted]') && !block.parentElement?.closest('.standard-markdown')
		);
		// Replies without markdown are UI states such as "This response didn't load".
		if (blocks.length === 0) return;

		const response = doc.createElement('div');
		response.className = 'font-claude-response';
		const body = response.appendChild(doc.createElement('div'));
		body.className = 'standard-markdown';
		blocks.forEach(block => body.append(...Array.from(block.childNodes)));
		message.replaceWith(response);
	});
}

function nextFrame(): Promise<void> {
	// requestAnimationFrame doesn't fire in background tabs, so cap the wait.
	return new Promise(resolve => {
		const timer = setTimeout(resolve, 100);
		requestAnimationFrame(() => {
			clearTimeout(timer);
			resolve();
		});
	});
}

async function waitFor(condition: () => boolean, timeout: number): Promise<boolean> {
	const deadline = Date.now() + timeout;
	while (!condition()) {
		if (Date.now() > deadline) return false;
		await new Promise(resolve => setTimeout(resolve, 25));
	}
	return true;
}
