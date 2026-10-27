import Defuddle from 'defuddle/full';
import { setElementHTML } from './dom-utils';
import { isClaudeConversation, prepareClaudeDocument } from './claude-conversation';

// Returns the document to hand to Defuddle. Usually that's the live page, but
// some sites need a prepared copy before Defuddle can see all of the content.
export async function prepareClipDocument(doc: Document): Promise<Document> {
	if (isClaudeConversation(doc.URL)) {
		try {
			return await prepareClaudeDocument(doc);
		} catch (error) {
			console.error('[Obsidian Clipper] Failed to prepare Claude conversation:', error);
		}
	}
	return doc;
}

// Parse document content for clipping. In reader mode, extracts from
// the article's original HTML to avoid reader UI artifacts.
export function parseForClip(doc: Document) {
	const readerArticle = doc.querySelector('.obsidian-reader-active .obsidian-reader-content article');
	if (readerArticle) {
		const readerDoc = doc.implementation.createHTMLDocument();
		const originalHtml = readerArticle.getAttribute('data-original-html');
		if (originalHtml) {
			setElementHTML(readerDoc.body, originalHtml);
		} else {
			readerDoc.body.replaceChildren(
				...Array.from(readerArticle.childNodes).map(n => readerDoc.importNode(n, true))
			);
		}
		return new Defuddle(readerDoc, { url: '' }).parse();
	}
	return new Defuddle(doc, { url: doc.URL }).parse();
}
