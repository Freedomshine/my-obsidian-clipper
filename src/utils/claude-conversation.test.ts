// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import Defuddle from 'defuddle';
import { isClaudeConversation, prepareClaudeDocument } from './claude-conversation';

const CHAT_URL = 'https://claude.ai/chat/0b5f6c1e-2d4a-4c8e-9f11-7a3e5d2c1b00';

// Mirrors the claude.ai transcript markup: rows inside a virtualized sizer,
// replies split into several markdown blocks, and thinking/tool status under
// [data-find-omitted].
function userRow(index: number, text: string): string {
	return `
		<div data-testid="transcript-row" data-index="${index}">
			<div data-testid="user-message"><p>${text}</p></div>
		</div>`;
}

function assistantRow(index: number, blocks: string[], { last = false, status = '' } = {}): string {
	return `
		<div data-testid="transcript-row" data-index="${index}"${last ? ' data-last-message="true"' : ''}>
			<div data-testid="assistant-message" data-cds="AssistantMessage">
				<h3 class="sr-only" data-find-omitted>Claude responded</h3>
				<div>
					${status ? `<div data-cds="TurnStatus" data-find-omitted><div class="standard-markdown"><p>${status}</p></div></div>` : ''}
					<div data-transcript-engine-root>
						<div data-cds="Prose">
							${blocks.map(block => `<div class="standard-markdown">${block}</div>`).join('')}
						</div>
					</div>
				</div>
			</div>
		</div>`;
}

function renderTranscript(rows: string[]): void {
	document.title = 'Planning a trip to Kyoto - Claude';
	document.body.innerHTML = `<main><div data-testid="transcript-sizer">${rows.join('')}</div></main>`;
}

const rows = [
	userRow(0, 'What should I see in Kyoto in autumn?'),
	assistantRow(1, [
		'<p>Autumn is the best season to visit the temples around Higashiyama.</p>',
		'<p>Tofuku-ji is famous for its maple valley seen from the Tsutenkyo bridge.</p>',
	], { status: 'Thought about seasonal foliage spots for a few seconds' }),
	userRow(2, 'How many days do I need for that?'),
	assistantRow(3, ['<p>Plan at least three full days to cover the eastern and northern temples.</p>'], { last: true }),
];

afterEach(() => {
	document.body.innerHTML = '';
});

describe('isClaudeConversation', () => {
	test('matches chat and share pages only', () => {
		expect(isClaudeConversation(CHAT_URL)).toBe(true);
		expect(isClaudeConversation('https://claude.ai/share/0b5f6c1e')).toBe(true);
		expect(isClaudeConversation('https://claude.ai/new')).toBe(false);
		expect(isClaudeConversation('https://example.com/chat/123')).toBe(false);
	});
});

describe('prepareClaudeDocument', () => {
	test('keeps every assistant reply, including all of its markdown blocks', async () => {
		renderTranscript(rows);

		const prepared = await prepareClaudeDocument(document);
		const result = new Defuddle(prepared, { url: CHAT_URL }).parse();

		expect(result.content).toContain('What should I see in Kyoto in autumn?');
		expect(result.content).toContain('Autumn is the best season to visit the temples');
		expect(result.content).toContain('Tofuku-ji is famous for its maple valley');
		expect(result.content).toContain('Plan at least three full days');
		expect(result.content).not.toContain('Thought about seasonal foliage');
		expect(result.content).not.toContain('Claude responded');
		expect(result.description).toBe('Claude conversation with 4 messages');
		// The live page keeps its own markup.
		expect(document.querySelectorAll('[data-testid="assistant-message"]')).toHaveLength(2);
	});

	test('renders the rest of a virtualized transcript through beforeprint', async () => {
		renderTranscript(rows.slice(2));
		const sizer = document.querySelector('[data-testid="transcript-sizer"]')!;
		const renderAll = vi.fn(() => sizer.insertAdjacentHTML('afterbegin', rows.slice(0, 2).join('')));
		const restore = vi.fn(() => {
			sizer.querySelectorAll('[data-index="0"], [data-index="1"]').forEach(row => row.remove());
		});
		window.addEventListener('beforeprint', renderAll);
		window.addEventListener('afterprint', restore);

		try {
			const prepared = await prepareClaudeDocument(document);
			const indexes = Array.from(prepared.querySelectorAll('[data-testid="transcript-row"]'), row => row.getAttribute('data-index'));

			expect(indexes).toEqual(['0', '1', '2', '3']);
			expect(renderAll).toHaveBeenCalledTimes(1);
			expect(restore).toHaveBeenCalledTimes(1);
			expect(document.querySelectorAll('[data-testid="transcript-row"]')).toHaveLength(2);
		} finally {
			window.removeEventListener('beforeprint', renderAll);
			window.removeEventListener('afterprint', restore);
		}
	});

	test('falls back to the rendered rows when printing does not render the transcript', async () => {
		renderTranscript(rows.slice(2));

		const prepared = await prepareClaudeDocument(document);
		const indexes = Array.from(prepared.querySelectorAll('[data-testid="transcript-row"]'), row => row.getAttribute('data-index'));

		expect(indexes).toEqual(['2', '3']);
	});
});
