// 专门用来编写Help文档
const helpMessages = new Map<string, string>([
    // Meta Commands
    ['CREATE', 'CREATE: 用于创建几何对象. 后面必须跟一个几何指令. 示例: CREATE POINT name=A x=0 y=0'],
    ['CLEAR', 'CLEAR: 清空画布.\n- 可选参数: color (或c, 画布背景色, CSS颜色值), geoColor (或g, 后续几何图形的默认颜色), labelColor (或l, 后续标签的默认颜色).'],
    ['SET', 'SET: 设置一个全局默认参数。\n- 必须参数: item (要设置的选项), value (要设置的值)。\n- 可用 item:\n  - backgroundColor: 画布背景色 (例如 "white", "#FFFFFF")。\n  - penColor: 默认画笔颜色。\n  - penSize: 默认画笔粗细 (例如 1)。\n  - labelFont: 默认标签字体 (例如 "12px Arial")。\n  - labelColor: 默认标签颜色。\n  - labelSize: 默认标签字号 (例如 12)。\n  - pointRadius: 默认点半径。\n  - pointFill: 默认点是否填充 (true/false)。\n  - drawLabelForPoints: 创建点时是否默认绘制标签 (true/false)。\n  - drawLabelForOthers: 创建其他图形时是否默认绘制标签 (true/false)。\n  - drawAfterCreate: 创建对象后是否默认立即绘制 (true/false)。\n  - geoColor/defaultGeoColor: 默认几何图形颜色。\n  - centerX: 视图中心X坐标。\n  - centerY: 视图中心Y坐标。\n  - scale: 视图缩放比例。\n  - lineLength: 直线/射线的绘制长度 (例如 200, 或 {slot} 表达式; auto/0 表示恢复默认: 只画到屏幕边缘).'],    ['HELP', 'HELP: 显示帮助信息.\n- 可选参数: cmd (要查询的指令名称).'],
    ['VIEW', 'VIEW: 设置视图变换, 实现平移和缩放.\n- 可选参数: centerX (视图中心的X坐标), centerY (视图中心的Y坐标), scale (缩放比例).'],
    ['DRAW', 'DRAW: 绘制一个或多个已创建的几何对象.\n- 必须参数: obj (一个或多个对象名称, 用逗号分隔).\n- 可选参数: color(或c), width, fill, style (\'dashed\'), label(或l, 标签文本), direction(或d, 标签位置), fontSize(或fs), backgroundColor(或bgc).'],
    ['TEXT', 'TEXT: 在绘图区绘制文字，并支持导出到 SVG.\n- 必须参数: x, y, text (文字内容可包含空格，建议放在指令末尾).\n- 可选参数: color(或c), fontSize(或fs), fontFamily, fontStyle, fontWeight, backgroundColor(或bgc), padding(或p).\n- 示例: TEXT x=2 y=3 text=\"距离 AB = {dist_AB}\" color=blue fontSize=16.'],
    ['FILL', 'FILL: 给封闭对象或区域填充颜色.\n- 必须参数: obj/region (区域、圆弓形区域、曲线-圆区域、POLYGON、TRIANGLE、RECTANGLE、CIRCLE 或 ELLIPSE 的名称), color (填充颜色).\n- 可选参数: borderColor (边界线颜色), width.\n- 示例: FILL obj=R color=lightblue borderColor=blue.'],
    ['MEASURE', 'MEASURE: 测量几何属性并存入槽位.\n- 必须参数: type (或t, 可选值: \'distance\', \'angle\', \'area\'), slot (或s, 用于存储结果的槽位名称).\n- 根据type不同, 需要其他参数:\n  - type=distance: 需 p1,p2 或 obj (线段对象).\n  - type=angle: 需 vertex,p1,p2 或 obj1,obj2 (两条线) 或 obj (角度对象).\n  - type=area: 需 obj (多边形,圆,椭圆).'],
    ['RUN', 'RUN: 执行一个已定义的代码块.\n- 必须参数: code (代码块的名称).'],
    ['CODE', 'CODE: 定义一个可重复使用的代码块.\n- 必须参数: name (代码块的名称).'],
    ['WITHRUN', 'WITHRUN: (暂未实现).'],
    ['CALCULATE', 'CALCULATE: 对槽位值进行数学运算.\n- 必须参数: expression (或e, 数学表达式, 可用{slot}引用槽位).\n- 可选参数: slot (或s, 用于存储结果的槽位名称).'],
    ['GETOBJ', 'GETOBJ: 获取一个对象的内部属性并存入槽位.\n- 必须参数: name (或n, object, o, 对象名称), property (或p, 属性名称), slot (或s, 用于存储结果的槽位名称).'],
    ['PRINT', 'PRINT: 在消息面板输出信息.\n- 必须参数: message (或m, 要显示的消息, 可用{slot}引用槽位).'],

    // Geometric Commands
    ['POINT', 'POINT: 创建一个点.\n- 必须参数: name (点的名称), x (X坐标), y (Y坐标).\n- 可选参数: radius (点的半径, 默认为1), real (布尔值, 标记是否为“实”点), draw (布尔值).'],
    ['LINE', 'LINE: 通过两点创建一条直线.\n- 必须参数: name, p1, p2.\n- 可选参数: draw.\n- 绘制长度: 直线的绘制长度由 SET item=lineLength value=<n> 控制 (以 p1、p2 的中点为基准向两端各延伸一半). 未设置时默认只画到屏幕边缘, 不会无限延伸, 导出 SVG 也不会被撑大.'],
    ['SEGMENT', 'SEGMENT: 通过两点创建一条线段.\n- 必须参数: name, p1, p2.\n- 可选参数: draw.'],
    ['RAY', 'RAY: 创建一条射线.\n- 必须参数: name, vertex (或v, 顶点), p1 (射线上另一点).\n- 可选参数: draw.\n- 绘制长度: 由 SET item=lineLength value=<n> 控制 (从顶点向前延伸 n). 未设置时默认只画到屏幕边缘.'],
    ['MIDPOINT', 'MIDPOINT: 创建两点的中点.\n- 必须参数: name, p1, p2.\n- 可选参数: draw.'],
    ['PERPENDICULAR_FOOT', 'PERPENDICULAR_FOOT: 创建点到直线的垂足.\n- 必须参数: name (或n, 垂足名称), from (或f, 点名), on (或o, 直线名).\n- 可选参数: draw.'],
    ['REFLECTED_POINT', 'REFLECTED_POINT: 创建一个点的对称点.\n- 必须参数: name (或n, 新点名称), obj (或o, 要对称的点).\n- 对称方式 (二选一): center (或c, 中心对称的点) 或 axis (或a, 对称轴).\n- 可选参数: draw.'],
    ['ROTATED_POINT', 'ROTATED_POINT: 创建一个点绕另一中心点旋转后的新点.\n- 必须参数: name (或n, 新点名称), obj (或o, 要旋转的点), center (或c, 旋转中心), angle (或a, 旋转角度, 单位:度).\n- 可选参数: draw.'],
    ['INTERSECT', 'INTERSECT: 创建两个对象的交点.\n- 必须参数: name (或n, 交点名称, 多个交点用逗号分隔), obj1(或o1), obj2(或o2).\n- 可选参数: draw.'],
    ['POINT_ON_LINE', 'POINT_ON_LINE: 在直线上沿指定方向和距离创建点.\n- 必须参数: name, line (或l), point (或p, 起始点), distance (或d, 距离).\n- 可选参数: draw.'],
    ['PERP_BISECTOR', 'PERP_BISECTOR: 创建两点连线的垂直平分线.\n- 必须参数: name, p1, p2.\n- 可选参数: draw.'],
    ['PERPENDICULAR', 'PERPENDICULAR: 创建经过指定点且垂直于指定直线的垂线.\n- 必须参数: name, point (或p), line (或l).\n- 可选参数: draw.'],
    ['PARALLEL', 'PARALLEL: 创建经过指定点且平行于指定直线的平行线.\n- 必须参数: name, point (或p), line (或l).\n- 可选参数: draw.'],
    ['ANGLE_BISECTOR', 'ANGLE_BISECTOR: 创建一个角的平分线.\n- 必须参数: name, angle (或a, 角对象名称).\n- 可选参数: draw.'],
    ['CIRCUMCIRCLE', 'CIRCUMCIRCLE: 创建三点的外接圆.\n- 必须参数: name, p1, p2, p3.\n- 可选参数: draw.'],
    ['INCIRCLE', 'INCIRCLE: 创建三点的内切圆.\n- 必须参数: name, p1, p2, p3.\n- 可选参数: draw.'],
    ['TANGENT', 'TANGENT: 创建圆的切线.\n- 必须参数: name, circle (或c), point (或p, 圆外或圆上的点).\n- 可选参数: draw.'],
    ['POLYGON', 'POLYGON: 创建多边形.\n- 必须参数: name, points (或p, 顶点列表, 逗号分隔).\n- 可选参数: draw.'],
    ['REGION', 'REGION: 创建一个可填充区域.\n- 普通区域必须参数: name, boundary (或points/p, 按边界顺序排列的点名, 逗号分隔); 区域自动闭合且不允许边界自交.\n- 圆弓形区域: name, circle, line, side (side=left/right, 按 line.p1 -> line.p2 的方向判断). line 必须是 LINE，且必须与 circle 相交于两个点.\n- 曲线-圆区域: name, curve, circle, side (side=above/below). curve 必须是 y=f(x) 的 CURVE，曲线范围内必须恰有两个交点.\n- 示例: CREATE REGION name=R boundary=A,B,C,D; CREATE REGION name=cap circle=C line=L side=left; 或 CREATE REGION name=R curve=P circle=C side=above; 然后使用 FILL.'],
    ['TRIANGLE', 'TRIANGLE: 创建三角形.\n- 必须参数: name, p1, p2, p3.\n- 可选参数: draw.'],
    ['RECTANGLE', 'RECTANGLE: 创建矩形.\n- 必须参数: name, p1 (一个顶点), width (或w), height (或h).\n- 可选参数: draw.'],
    ['CIRCLE', 'CIRCLE: 创建圆.\n- 必须参数: name.\n- 创建方式(多选一):\n  1. center, radius.\n  2. center, chord (弦对象).\n  3. center, chordPt1, chordPt2.\n  4. chord, centerAngle.\n  5. chordPt1, chordPt2, centerAngle.\n- 可选参数: draw.'],
    ['ELLIPSE', 'ELLIPSE: 创建椭圆.\n- 必须参数: name, center, radiusX, radiusY.\n- 可选参数: rotation, draw.'],
    ['PARABOLA', 'PARABOLA: 创建抛物线.\n- 必须参数: name.\n- 创建方式(二选一):\n  1. vertex, pValue, rotateAngle.\n  2. a, b, c (对于 y=ax²+bx+c).\n- 可选参数: draw.'],
    ['HYPERBOLA', 'HYPERBOLA: 创建双曲线.\n- 必须参数: name.\n- 创建方式(二选一):\n  1. center, aValue, bValue, rotateAngle.\n  2. f1, f2, diff (焦距差).\n- 可选参数: draw.'],
    ['ANGLE', 'ANGLE: 创建角.\n- 必须参数: name, vertex (或v, 顶点), p1 (角上一点).\n- 定义方式 (二选一): p2 (角上另一点) 或 angle (或a, 角度值, 单位:度).\n- 可选参数: showArc, draw.'],
    ['FOCIS', 'FOCIS: 创建椭圆、双曲线或抛物线的焦点.\n- 必须参数: name (焦点名称, 多个用逗号分隔), obj (或o, 曲线对象).\n- 可选参数: draw.'],
    ['RANDOMPOINT', 'RANDOMPOINT: 在对象上创建随机点.\n- 必须参数: name, obj.\n- 可选参数: start, end (范围), draw.'],
    ['SLOT', 'SLOT: 创建一个可用于计算的槽位(变量).\n- 必须参数: name, value (或v) 或 expression (或e).'],
    ['FUNCTION', 'FUNCTION: 创建一个数学上的纯函数, 类似于SLOT.\n- 必须参数: name, value (或v) 或 expression (或e) 表达式, args (或a) 参数个数.'],
    ['ANIMATION', 'ANIMATION: 创建动画.\n- 必须参数: name, code (执行的代码块), slot (更新的槽位).\n- 可选参数: interval (毫秒), repeat (布尔值), period (完整周期的帧数，主要用于导出 SVG).\n- 例如: CREATE ANIMATION name=ani interval=50 repeat=true code=frame slot=slot_ani period=40。period=40 表示导出 40 帧后回到完整周期。'],
]);

const metaCommands = ['CLEAR', 'SET', 'HELP', 'VIEW', 'TRANSLATE', 'DRAW', 'TEXT', 'FILL', 'MEASURE', 'RUN', 'CODE', 'WITH', 'CALCULATE', 'GETOBJ', 'PRINT', 'CREATE'];
const geometricCommands = [
    'POINT', 'LINE', 'SEGMENT', 'RAY', 'MIDPOINT', 'PERPENDICULAR_FOOT', 'REFLECTED_POINT', 'ROTATED_POINT',
    'INTERSECT', 'POINT_ON_LINE', 'PERP_BISECTOR', 'PERPENDICULAR', 'PARALLEL', 'ANGLE_BISECTOR', 'CIRCUMCIRCLE',
    'INCIRCLE', 'TANGENT', 'POLYGON', 'REGION', 'TRIANGLE', 'RECTANGLE', 'CIRCLE', 'ELLIPSE', 'PARABOLA', 'HYPERBOLA',
    'ANGLE', 'FOCIS', 'RANDOMPOINT', 'SLOT', 'ANIMATION'
];

export function getHelpMessages(metaCommand: string, createCommand: string): string {
    metaCommand = metaCommand.toUpperCase();
    createCommand = createCommand.toUpperCase();

    // 如果两个参数都为空, 输出所有元指令
    if (!metaCommand && !createCommand) {
        let helpText = '支持的元指令:\n';
        metaCommands.forEach(cmd => {
            helpText += `- ${cmd}\n`;
        });
        helpText += "\n使用 'HELP cmd=指令名称' 查看具体用法.";
        return helpText;
    }

    // 如果第一个参数是CREATE, 且第二个参数为空, 输出所有几何指令
    if (metaCommand === 'CREATE' && !createCommand) {
        let helpText = '支持的几何指令 (需在CREATE后使用):\n';
        geometricCommands.forEach(cmd => {
            helpText += `- ${cmd}\n`;
        });
        helpText += "\n使用 'HELP cmd=指令名称' 查看具体用法.";
        return helpText;
    }

    // 如果第一个参数不为空且不是CREATE, 输出对应元指令的帮助
    if (metaCommand && metaCommand !== 'CREATE') {
        return helpMessages.get(metaCommand) || `未找到元指令: ${metaCommand}`;
    }

    // 如果第一个参数为空或者为CREATE, 且第二个参数不为空, 输出对应几何指令的帮助
    if ((!metaCommand || metaCommand === 'CREATE') && createCommand) {
        return helpMessages.get(createCommand) || `未找到几何指令: ${createCommand}`;
    }

    // 默认返回通用帮助信息
    return getHelpMessages('', '');
}
