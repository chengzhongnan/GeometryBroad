/**
 * 两圆求交点端到端验证（离线，无需浏览器）。
 *
 * 覆盖两条链路：
 *   A. 命令生成层 planSelectionOperation('circleIntersect', ...)：
 *      - 无交点 → blocked；
 *      - 两交点都缺 → newPointCount=2；
 *      - 已有一个交点存在 → newPointCount=1（只补建另一个）。
 *   B. 解释器执行层 CREATE INTERSECT（两圆）：
 *      - 两个都缺 → 建出两个点；
 *      - 已有一个存在 → 只新建一个，且**已存在点的坐标不被改动**（回归上一版覆盖 bug）。
 */
import { GeometryDSLInterpreter } from '../src/core/DSLInterpreter';
import { planSelectionOperation, type ObjectRef } from '../src/core/geometryCommandBuilder';

const check = (name: string, ok: boolean, extra = '') =>
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
const approx = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

// 构造解释器 + 上下文（模仿 GeometryCanvas 的 buildContext）。
function makeInterp(script: string) {
    const interp = new GeometryDSLInterpreter();
    interp.execute(script);
    const context = {
        script,
        objectNames: Array.from(interp.getAllObjects().keys()),
        getCircleInfo: (name: string) => interp.getCircleInfo(name),
        listPointCoords: () => interp.getAllPointCoords(),
        getPointCoords: (name: string) => interp.getPointCoords(name),
    };
    return { interp, context };
}

// 用点名建圆的公共前缀：两个圆心各需要一条 CREATE POINT。
const circleScript = (ax: number, ay: number, ar: number, bx: number, by: number, br: number) => [
    `CREATE POINT name=OA x=${ax} y=${ay}`,
    `CREATE POINT name=OB x=${bx} y=${by}`,
    `CREATE CIRCLE name=c1 center=OA radius=${ar}`,
    `CREATE CIRCLE name=c2 center=OB radius=${br}`,
];

// ---------------------------------------------------------------- A. 命令生成层

// A1) 两圆外离（d=20 > r1+r2=5）→ 无交点，菜单应置灰。
{
    const script = circleScript(0, 0, 3, 20, 0, 2).join('\n');
    const { context } = makeInterp(script);
    const objects: ObjectRef[] = [{ name: 'c1', type: 'circle' }, { name: 'c2', type: 'circle' }];
    const plan = planSelectionOperation('circleIntersect', objects, context);
    check('A1 外离圆 blocked', Boolean(plan.blocked), plan.blocked ?? '');
}

// A2) 两圆相交（c1 圆心(0,0) r=5；c2 圆心(6,0) r=5）→ 两个交点，都缺 → newPointCount=2。
{
    const script = circleScript(0, 0, 5, 6, 0, 5).join('\n');
    const { context } = makeInterp(script);
    const objects: ObjectRef[] = [{ name: 'c1', type: 'circle' }, { name: 'c2', type: 'circle' }];
    const plan = planSelectionOperation('circleIntersect', objects, context);
    check('A2 相交圆 newPointCount=2', !plan.blocked && plan.newPointCount === 2, `blocked=${plan.blocked ?? '-'} count=${plan.newPointCount}`);
}

// A3) 已有一个交点存在（把 (3,4) 先建成点名 P0）→ 只补建另一个 → newPointCount=1。
{
    const script = [...circleScript(0, 0, 5, 6, 0, 5), 'CREATE POINT name=P0 x=3 y=4'].join('\n');
    const { context } = makeInterp(script);
    const objects: ObjectRef[] = [{ name: 'c1', type: 'circle' }, { name: 'c2', type: 'circle' }];
    const plan = planSelectionOperation('circleIntersect', objects, context);
    check('A3 已存在一个交点 newPointCount=1', !plan.blocked && plan.newPointCount === 1, `blocked=${plan.blocked ?? '-'} count=${plan.newPointCount}`);
}

// A4) 两个交点都已存在 → 没有可建的点 → 应 blocked。
{
    const script = [...circleScript(0, 0, 5, 6, 0, 5), 'CREATE POINT name=P0 x=3 y=4', 'CREATE POINT name=P1 x=3 y=-4'].join('\n');
    const { context } = makeInterp(script);
    const objects: ObjectRef[] = [{ name: 'c1', type: 'circle' }, { name: 'c2', type: 'circle' }];
    const plan = planSelectionOperation('circleIntersect', objects, context);
    check('A4 两交点都已存在 blocked', Boolean(plan.blocked), plan.blocked ?? '');
}

// ---------------------------------------------------------------- B. 解释器执行层

// B1) 两个交点都缺：CREATE INTERSECT 应建出两个点，坐标正确。
{
    const script = [...circleScript(0, 0, 5, 6, 0, 5), 'CREATE INTERSECT name=Q1,Q2 obj1=c1 obj2=c2 draw=true'].join('\n');
    const { interp } = makeInterp(script);
    const names = Array.from(interp.getAllObjects().keys());
    const q1 = interp.getPointCoords('Q1');
    const q2 = interp.getPointCoords('Q2');
    const okCoords =
        q1 !== null && q2 !== null &&
        approx(q1.x, 3) && approx(Math.abs(q1.y), 4) &&
        approx(q2.x, 3) && approx(Math.abs(q2.y), 4) &&
        Math.abs(q1.y - q2.y) > 1e-6;
    check('B1 两交点都缺 → 建出 2 个点', names.includes('Q1') && names.includes('Q2') && okCoords,
        `Q1=${JSON.stringify(q1)} Q2=${JSON.stringify(q2)}`);
}

// B2) 关键回归：已有一个交点存在时，只新建另一个，且已存在点坐标不被改写。
{
    const script = [...circleScript(0, 0, 5, 6, 0, 5), 'CREATE POINT name=P0 x=3 y=4', 'CREATE INTERSECT name=Q1,Q2 obj1=c1 obj2=c2 draw=true'].join('\n');
    const { interp } = makeInterp(script);

    const p0 = interp.getPointCoords('P0')!;
    const pointsAfter = interp.getAllPointCoords();
    const newOnMissing = pointsAfter.filter(p => approx(p.x, 3) && approx(p.y, -4));
    const onExisting = pointsAfter.filter(p => approx(p.x, 3) && approx(p.y, 4));

    check('B2 已存在 P0 (3,4) 坐标未被改写', approx(p0.x, 3) && approx(p0.y, 4), `P0=${JSON.stringify(p0)}`);
    check('B2 已存在交点未被重复创建（仍只有 P0）', onExisting.length === 1 && onExisting[0].name === 'P0',
        `on(3,4)=${JSON.stringify(onExisting)}`);
    check('B2 只补建了缺少的那个交点 (3,-4)', newOnMissing.length === 1,
        `on(3,-4)=${JSON.stringify(newOnMissing)}`);
}

// B3) 相切两圆（唯一交点）且该点已存在 → 不重复建、不覆盖。
{
    // c1 圆心(0,0) r=5；c2 圆心(8,0) r=3 → 外切于 (5,0)。
    const script = [...circleScript(0, 0, 5, 8, 0, 3), 'CREATE POINT name=T x=5 y=0', 'CREATE INTERSECT name=Q1 obj1=c1 obj2=c2 draw=true'].join('\n');
    const { interp } = makeInterp(script);
    const pts = interp.getAllPointCoords();
    const on5 = pts.filter(p => approx(p.x, 5) && approx(p.y, 0));
    const t = interp.getPointCoords('T')!;
    check('B3 相切点已存在 → 不重复建', on5.length === 1 && on5[0].name === 'T', `on(5,0)=${JSON.stringify(on5)}`);
    check('B3 相切点 T 坐标未被改写', approx(t.x, 5) && approx(t.y, 0), `T=${JSON.stringify(t)}`);
}

console.log('done');
