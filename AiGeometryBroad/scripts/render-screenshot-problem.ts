import { readFileSync, writeFileSync } from 'node:fs';
import { exportScriptToSvg } from '../src/core/svgExport';

const scriptPath = 'D:/Projects/JS/GeometryBroad/outputs/screenshot-geometry-problem.dsl';
const outputPath = 'D:/Projects/JS/GeometryBroad/outputs/screenshot-geometry-problem.svg';
const script = readFileSync(scriptPath, 'utf8');

const messages: string[] = [];
const svg = exportScriptToSvg(script, {
    width: 960,
    height: 720,
    background: 'white',
    onMessage: (level, line, message) => messages.push(`[${level}] line ${line}: ${message}`),
});

writeFileSync(outputPath, svg, 'utf8');
if (messages.length > 0) {
    console.warn(messages.join('\n'));
}
console.log(`Wrote ${outputPath}`);
