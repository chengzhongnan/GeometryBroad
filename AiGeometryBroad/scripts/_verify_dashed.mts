/**
 * 虚线样式回归验证：确认 `dashed=true` / `dash=true` / `style=dashed` 都能让
 * 几何对象（外接圆、内切圆、普通圆、线段）画成虚线，且导出 SVG 里带上 stroke-dasharray。
 *
 * 背景：`drawObject` 里解析绘制选项时历史上只认 `style=dashed` 和 `s=dashed`，
 * 于是 `CREATE CIRCUMCIRCLE ... dashed=true` 被静默忽略、圆画成实线。
 * 本脚本用导出 SVG 的文本做断言（SVG 走 SvgRenderContext，setLineDash -> stroke-dasharray）。
 */
import { exportScriptToSvg } from '../src/core/svgExport';

const check = (name: string, ok: boolean, extra = '') =>
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);

const W = 400;
const H = 300;

function buildSvg(script: string): string {
    return exportScriptToSvg(script, { width: W, height: H });
}

// 统计 stroke-dasharray 出现次数（非空即为虚线元素）。
const dashCount = (svg: string) => (svg.match(/stroke-dasharray="[^"]+"/g) || []).length;

// 基础三点，供外接圆/内切圆使用（不共线）。
const THREE_POINTS = [
    'CREATE POINT name=A x=-2 y=-1',
    'CREATE POINT name=B x=3 y=0',
    'CREATE POINT name=C x=0 y=4',
].join('\n');

// 1) 外接圆 dashed=true → 必须有 stroke-dasharray（用户报告的场景）。
{
    const svg = buildSvg([THREE_POINTS, 'CREATE CIRCUMCIRCLE name=cc p1=A p2=B p3=C draw=true dashed=true'].join('\n'));
    check('1 外接圆 dashed=true 画成虚线', dashCount(svg) >= 1, `dasharray×${dashCount(svg)}`);
}

// 2) 外接圆写 style=dashed（老写法）仍然有效 —— 不能被本次改动弄坏。
{
    const svg = buildSvg([THREE_POINTS, 'CREATE CIRCUMCIRCLE name=cc p1=A p2=B p3=C draw=true style=dashed'].join('\n'));
    check('2 外接圆 style=dashed 仍有效', dashCount(svg) >= 1, `dasharray×${dashCount(svg)}`);
}

// 3) 外接圆 dash=true（别名）也应生效。
{
    const svg = buildSvg([THREE_POINTS, 'CREATE CIRCUMCIRCLE name=cc p1=A p2=B p3=C draw=true dash=true'].join('\n'));
    check('3 外接圆 dash=true 生效', dashCount(svg) >= 1, `dasharray×${dashCount(svg)}`);
}

// 4) 内切圆 dashed=true。
{
    const svg = buildSvg([THREE_POINTS, 'CREATE INCIRCLE name=ic p1=A p2=B p3=C draw=true dashed=true'].join('\n'));
    check('4 内切圆 dashed=true 画成虚线', dashCount(svg) >= 1, `dasharray×${dashCount(svg)}`);
}

// 5) 普通圆 dashed=true。
{
    const svg = buildSvg([
        'CREATE POINT name=O x=0 y=0',
        'CREATE CIRCLE name=c center=O radius=3 draw=true dashed=true',
    ].join('\n'));
    check('5 普通圆 dashed=true 画成虚线', dashCount(svg) >= 1, `dasharray×${dashCount(svg)}`);
}

// 6) 线段 dashed=true（通用对象也应生效）。
{
    const svg = buildSvg([
        'CREATE POINT name=A x=-2 y=-1',
        'CREATE POINT name=B x=3 y=0',
        'CREATE SEGMENT name=s p1=A p2=B draw=true dashed=true',
    ].join('\n'));
    check('6 线段 dashed=true 画成虚线', dashCount(svg) >= 1, `dasharray×${dashCount(svg)}`);
}

// 7) 不写 dashed → 不应有虚线（默认实线，确认没有误开）。
{
    const svg = buildSvg([THREE_POINTS, 'CREATE CIRCUMCIRCLE name=cc p1=A p2=B p3=C draw=true'].join('\n'));
    check('7 默认实线（无 dasharray）', dashCount(svg) === 0, `dasharray×${dashCount(svg)}`);
}

// 8) dashed=false 显式关闭：即使同时写了 style=dashed，也应以 dashed=false 为准（实线）。
{
    const svg = buildSvg([THREE_POINTS, 'CREATE CIRCUMCIRCLE name=cc p1=A p2=B p3=C draw=true style=dashed dashed=false'].join('\n'));
    check('8 dashed=false 显式关闭覆盖 style', dashCount(svg) === 0, `dasharray×${dashCount(svg)}`);
}

console.log('done');
