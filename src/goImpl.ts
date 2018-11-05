/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import { getBinPath, getToolsEnvVars } from './util';
import { promptForMissingTool } from './goInstallTools';
import { dirname } from 'path';

// Supports only passing interface, see TODO in implCursor to finish
// it is meant to validate:
//
// 		'<recvName> <recvType> <interfaceType>'
//
const inputRegex = /^([\w_]+\ \*?[\w_]+\ )?(\w[\w\.-]*)$/;

/**
 * A helper interface that represents Source code and a
 * way to retrieve portions of it.
 *
 * It aids in testing the features of goImpl
 */
interface Source {
	getText(range: vscode.Range): string;
}

/**
 * Determones whether the given string is a boundary for a "word".
 * @param str The str to be evaluated.
 * @param bounds A string where each char is a possible word boundary.
 */
function isWordBoundary(str: string, bounds: string= `\t `): boolean {
	return bounds.split('').map(b => str === b ).filter(r => !!r).length > 0;
}

/**
 * Finds a range that contains a word from a given starting cursor range.
 * It will expand the range until it finds a starting word boundary and an
 * end word boundary.
 * 
 * @param source The source from where the search will happen.
 * @param cursor The starting point for the search.
 */
export function findWordRange(source: Source, sourceStart, sourceEnd: vscode.Position, cursor: vscode.Range): vscode.Range | null {

	let word = source.getText(cursor);

	let scanFinished = false;
	let foundWord = false;

	let scanRange = cursor;
	do {

		if (scanRange.start === sourceStart && scanRange.end === sourceEnd) {
			scanFinished = true;
			continue;
		}

		if (isWordBoundary(word[0]) && isWordBoundary(word[word.length - 1])) {
			scanFinished = true;
			foundWord = true;
			continue;
		}

		if (!isWordBoundary(word[0])) {
			scanRange = new vscode.Range(
				new vscode.Position(scanRange.start.line, scanRange.start.character - 1),
				scanRange.end,
			);
		}

		if (!isWordBoundary(word[word.length - 1])) {
			scanRange = new vscode.Range(
				scanRange.start,
				new vscode.Position(scanRange.end.line, scanRange.end.character + 1),
			);
		}

		word = source.getText(scanRange);

	} while (!scanFinished);

	if (!foundWord) {
		return null;
	}

	return new vscode.Range(
		new vscode.Position(scanRange.start.line, scanRange.start.character + 1),
		new vscode.Position(scanRange.end.line, scanRange.end.character - 1),
	);
}


/**
 * Validate input from the user.
 *
 * @param input The input to be validated.
 */
export function validateUserInput(input: string): {recvSpec: string, interfaceType: string} | null {
	const matches = input.match(inputRegex);
	if (!matches) { return null; }

	return {
		recvSpec: matches[1],
		interfaceType: matches[2]
	};
}

/**
 * inferRecvSpec will scan starting fromt given selection until a
 * space is found to determin the receiver name and type
 *
 * @param editor The editor that holds the current Go source.
 * @param cursor The current location within the document
 */
export function inferRecvSpec(source: Source, sourceStart, sourceEnd: vscode.Position, cursor: vscode.Range): string {

	let currentWord = source.getText(findWordRange(source, sourceStart, sourceEnd, cursor));

	let recvName = currentWord[0].toLocaleLowerCase();
	let recvType = currentWord;

	return `${recvName} *${recvType}`;
}

/**
 * impleCursor shows an input box requesting the information
 * for the interface stubs that will be generated.
 */
export function implCursor() {
	let cursor = vscode.window.activeTextEditor.selection;

	return vscode.window.showInputBox({
		placeHolder: 'f *File io.Closer',
		prompt: 'Enter receiver and interface to implement.'
	}).then(implInput => {

		if (typeof implInput === 'undefined') {
			return;
		}

		const parsed = validateUserInput(implInput);
		if (!parsed) {
			vscode.window.showInformationMessage(`Not parsable input: ${implInput}`);
			return;
		}

		if (parsed.recvSpec === null) {
			let doc = vscode.window.activeTextEditor.document;
			parsed.recvSpec = inferRecvSpec(doc,
				new vscode.Position(cursor.start.line, 0),
				doc.lineAt(cursor.start.line).range.end,
				cursor);
		}

		runGoImpl([parsed.recvSpec, parsed.interfaceType], cursor.start);
	});
}

function runGoImpl(args: string[], insertPos: vscode.Position) {
	let goimpl = getBinPath('impl');
	let p = cp.execFile(goimpl, args, { env: getToolsEnvVars(), cwd: dirname(vscode.window.activeTextEditor.document.fileName) }, (err, stdout, stderr) => {
		if (err && (<any>err).code === 'ENOENT') {
			promptForMissingTool('impl');
			return;
		}

		if (err) {
			vscode.window.showInformationMessage(`Cannot stub interface: ${stderr}`);
			return;
		}

		vscode.window.activeTextEditor.edit(editBuilder => {
			editBuilder.insert(insertPos, stdout);
		});
	});
	if (p.pid) {
		p.stdin.end();
	}
}