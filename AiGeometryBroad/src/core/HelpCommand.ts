// 专门用来编写Help文档
import { GEOMETRIC_COMMANDS, META_COMMANDS } from './dslCommandNames';

const helpMessages = new Map<string, string>([
    // Meta Commands
    ['CREATE', 'CREATE: 用于创建几何对象. 后面必须跟一个几何指令. 示例: CREATE POINT name=A x=0 y=0\n- 可选参数 draw=true: 创建后绘制该对象. 注意它**不在创建时立即绘制**, 而是等整个脚本执行完统一绘制(相当于末尾隐含一条 DRAW), 这样对象可以引用后面才创建的截止点/交点. 绘制顺序 = 创建顺序. TEXT/AXIS 等非几何对象不受影响.\n- 同一行可以附加任何 DRAW 支持的绘图选项(如 color/width/label). 标签只认显式写的 label=: name 是给引用用的标识符, 不会自动画到图上. 变量面板的「可编辑属性」和画布右键的「修改标签…」改的都是这个 label=.'],
    ['CLEAR', 'CLEAR: 清空画布.\n- 可选参数: color (或c, 画布背景色, CSS颜色值), geoColor (或g, 后续几何图形的默认颜色), labelColor (或l, 后续标签的默认颜色).'],
    ['SET', 'SET: 设置一个全局默认参数。\n- 必须参数: item (要设置的选项), value (要设置的值)。\n- 可用 item:\n  - backgroundColor: 画布背景色 (例如 "white", "#FFFFFF")。\n  - penColor: CLEAR 时默认的画笔/背景色。\n  - penSize: 默认线宽, 单位屏幕像素 (缺省 1)。指令里写 width=<n> 可单独覆盖。\n  - labelFont: 默认标签字体 (例如 "12px Arial")。指令里写 fontSize/fontFamily 可单独覆盖。\n  - labelColor: 默认标签颜色。\n  - labelSize: 默认标签字号 (例如 12)。\n  - pointRadius: 默认点半径, 单位屏幕像素 (缺省 4)。CREATE POINT 里写 radius=<n> 可单独覆盖。\n  - pointFill: CREATE POINT 建的点是否默认实心 (true/false, 缺省 false 即空心)。\n  - drawLabelForPoints: 点是否绘制标签 (true/false, 缺省 true)。这只是总开关: 对象自己还得写了 label= 才会出现文字。\n  - drawLabelForOthers: 非点对象是否绘制标签 (true/false, 缺省 false)。同上, 需要显式 label=。\n  - geoColor/defaultGeoColor: 默认几何图形颜色。\n  - centerX: 视图中心X坐标 (等价于 VIEW centerX)。\n  - centerY: 视图中心Y坐标 (等价于 VIEW centerY)。\n  - scale: 视图缩放比例。\n  - lineLength: 直线/射线的绘制长度 (例如 200, 或 {slot} 表达式; auto/0 表示恢复默认: 只画到屏幕边缘).'],    ['HELP', 'HELP: 显示帮助信息.\n- 可选参数: cmd (要查询的指令名称).'],
    ['VIEW', 'VIEW: 设置视图变换, 实现平移、缩放和旋转.\n- 可选参数: centerX (视图中心的X坐标), centerY (视图中心的Y坐标), scale (缩放比例), rotation (视图旋转角度, 单位为度, 正值表示屏幕上顺时针, 绕画布中心旋转; 别名 rotate/angle).'],
    ['DRAW', 'DRAW: 绘制一个或多个已创建的几何对象.\n- 必须参数: obj (一个或多个对象名称, 用逗号分隔).\n- 可选参数: color(或c), width, fill, style (\'dashed\'), dashed (或dash, 布尔; dashed=true 与 style=dashed 等效, dashed=false 强制实线), label(或l, 标签文本; 不写就没有标签, name 不会自动当标签), direction(或d, 标签位置), fontSize(或fs), backgroundColor(或bgc).\n- 说明: 本指令在它所在的位置立即绘制, 所以它画出来的对象层级在 draw=true 的对象之下(后者统一等到脚本末尾才画). 若目标对象本身也写了 draw=true, 本指令只覆盖其样式, 不会重复画一遍.'],
    ['TEXT', 'TEXT: 在绘图区绘制文字，并支持导出到 SVG.\n- 必须参数: x, y, text (文字内容可包含空格，建议放在指令末尾).\n- 可选参数: color(或c), fontSize(或fs), fontFamily, fontStyle, fontWeight, backgroundColor(或bgc), padding(或p).\n- 示例: TEXT x=2 y=3 text=\"距离 AB = {dist_AB}\" color=blue fontSize=16.'],
    ['FILL', 'FILL: 给封闭对象或区域填充颜色.\n- 必须参数: obj/region (区域、圆弓形区域、曲线-圆区域、POLYGON、TRIANGLE、RECTANGLE、CIRCLE 或 ELLIPSE 的名称), color (填充颜色).\n- 可选参数: borderColor (边界线颜色), width.\n- 说明: 若目标对象本身写了 draw=true(还排在待绘队列里), 本指令的填充会并入它的待绘样式, 等脚本末尾统一绘制; 否则在本指令位置立即绘制. 两种情况对象都只画一次.\n- 示例: FILL obj=R color=lightblue borderColor=blue.'],
    ['MEASURE', 'MEASURE: 测量几何属性并存入槽位.\n- 必须参数: type (或t, 可选值: \'distance\', \'angle\', \'area\'), slot (或s, 用于存储结果的槽位名称).\n- 根据type不同, 需要其他参数:\n  - type=distance: 需 p1,p2 或 obj (线段对象).\n  - type=angle: 需 vertex,p1,p2 或 obj1,obj2 (两条线) 或 obj (角度对象).\n  - type=area: 需 obj (多边形,圆,椭圆).'],
    ['RUN', 'RUN: 执行一个已定义的代码块.\n- 必须参数: code (代码块的名称).'],
    ['CODE', 'CODE: 定义一个可重复使用的代码块.\n- 必须参数: name (代码块的名称).'],
    ['WITH', 'WITH: 当 with 指定的插槽值不为零时, 执行该代码块.\n- 必须参数: code (代码块名称), with (插槽名或数值).\n- 说明: 与 RUN 的区别是带条件 —— with 为 0 时整块跳过.\n- 示例: WITH code=draw_special_circle with={condition_slot}'],
    ['CALCULATE', 'CALCULATE: 对槽位值进行数学运算.\n- 必须参数: expression (或e, 数学表达式, 可用{slot}引用槽位).\n- 可选参数: slot (或s, 用于存储结果的槽位名称).'],
    ['GETOBJ', 'GETOBJ: 获取一个对象的内部属性并存入槽位.\n- 必须参数: name (或n, object, o, 对象名称), property (或p, 属性名称), slot (或s, 用于存储结果的槽位名称).'],
    ['PRINT', 'PRINT: 在消息面板输出信息.\n- 必须参数: message (或m, 要显示的消息, 可用{slot}引用槽位).\n- 别名: MESSAGE (与 PRINT 完全等价).'],

    // Geometric Commands
    ['POINT', 'POINT: 创建一个点.\n- 必须参数: name (点的名称), x (X坐标), y (Y坐标).\n- 可选参数: radius (点的半径, 单位为屏幕像素, 缺省 4, 与 VIEW scale 无关), real (布尔值, 标记是否为“实”点), frozen (布尔值, 为 true 时该点在画布上无法拖动), draw (布尔值).'],
    ['LINE', 'LINE: 通过两点创建一条直线.\n- 必须参数: name, p1, p2.\n- 可选参数: draw, cutPoints (或 cutoffPoints/cuts).\n- 截止点 cutPoints (或 cutoffPoints/cuts) 是一串「点名 + 可选方向」，沿 p1->p2 排序后逐个翻转绘制状态：A 表示画到 A 后停止（A,B 会跳过 A 到 B）；-A 表示 A 的负方向一侧不画（从 A 开始）；+A 表示 A 的正方向一侧不画（到 A 为止）。因此 cutPoints=-A,+B 把直线截成线段 [A,B]，cutPoints=+A,-B 则挖掉中间一段。截止点可以引用这条线之后才定义的点（线上的点、交点都只能这样写），这种线会推迟到脚本末尾再画。截止点只影响绘制和命中测试，不改变几何定义.\n- 绘制长度: 直线的绘制长度由 SET item=lineLength value=<n> 控制 (以 p1、p2 的中点为基准向两端各延伸一半). 未设置时默认只画到屏幕边缘, 不会无限延伸, 导出 SVG 也不会被撑大.'],
    ['SEGMENT', 'SEGMENT: 通过两点创建一条线段.\n- 必须参数: name, p1, p2.\n- 可选参数: draw, cutPoints (或 cutoffPoints/cuts).\n- 截止点 cutPoints (或 cutoffPoints/cuts) 是一串「点名 + 可选方向」，沿 p1->p2 排序后逐个翻转绘制状态：A 表示画到 A 后停止（A,B 会跳过 A 到 B）；-A 表示 A 的负方向一侧不画（从 A 开始）；+A 表示 A 的正方向一侧不画（到 A 为止）。因此 cutPoints=-A,+B 把直线截成线段 [A,B]，cutPoints=+A,-B 则挖掉中间一段。截止点可以引用这条线之后才定义的点（线上的点、交点都只能这样写），这种线会推迟到脚本末尾再画。截止点只影响绘制和命中测试，不改变几何定义.'],
    ['RAY', 'RAY: 创建一条射线.\n- 必须参数: name, vertex (或v, 顶点), p1 (射线上另一点).\n- 可选参数: draw, cutPoints (或 cutoffPoints/cuts).\n- 截止点 cutPoints (或 cutoffPoints/cuts) 是一串「点名 + 可选方向」，沿 p1->p2 排序后逐个翻转绘制状态：A 表示画到 A 后停止（A,B 会跳过 A 到 B）；-A 表示 A 的负方向一侧不画（从 A 开始）；+A 表示 A 的正方向一侧不画（到 A 为止）。因此 cutPoints=-A,+B 把直线截成线段 [A,B]，cutPoints=+A,-B 则挖掉中间一段。截止点可以引用这条线之后才定义的点（线上的点、交点都只能这样写），这种线会推迟到脚本末尾再画。截止点只影响绘制和命中测试，不改变几何定义.\n- 绘制长度: 由 SET item=lineLength value=<n> 控制 (从顶点向前延伸 n). 未设置时默认只画到屏幕边缘.'],
    ['MIDPOINT', 'MIDPOINT: 创建两点的中点.\n- 必须参数: name, p1, p2.\n- 可选参数: draw.'],
    ['PERPENDICULAR_FOOT', 'PERPENDICULAR_FOOT: 创建点到直线的垂足.\n- 必须参数: name (或n, 垂足名称), from (或f, 点名), on (或o, 直线名).\n- 可选参数: draw.'],
    ['REFLECTED_POINT', 'REFLECTED_POINT: 创建一个点的对称点.\n- 必须参数: name (或n, 新点名称), obj (或o, 要对称的点).\n- 对称方式 (二选一): center (或c, 中心对称的点) 或 axis (或a, 对称轴).\n- 可选参数: draw.'],
    ['ROTATED_POINT', 'ROTATED_POINT: 创建一个点绕另一中心点旋转后的新点.\n- 必须参数: name (或n, 新点名称), obj (或o, 要旋转的点), center (或c, 旋转中心), angle (或a, 旋转角度, 单位:度).\n- 可选参数: draw.'],
    ['INTERSECT', 'INTERSECT: 创建两个对象的交点.\n- 必须参数: name (或n, 交点名称, 多个交点用逗号分隔), obj1(或o1), obj2(或o2).\n- 可选参数: draw.\n- 两个圆最多有两个交点: 给两个名字 (如 name=P,Q) 会一次建两个; 只给一个名字时第二个自动命名为 <名字>_2.\n- 去重: 如果某个交点所在位置已经有点存在 (坐标相同), 该交点不会被重复创建 —— 因此已经有一个交点时, 只会补建缺少的那一个, 且不会改动已存在点的坐标.'],
    ['POINT_ON_LINE', 'POINT_ON_LINE: 在直线上沿指定方向和距离创建点.\n- 必须参数: name, line (或l), point (或p, 起始点), distance (或d, 距离).\n- 可选参数: draw.'],
    ['POINT_ON_CIRCLE', 'POINT_ON_CIRCLE: 在圆周上、以圆心为原点给定角度(度)的位置创建点.\n- 必须参数: name, circle (或c), angle (或a, 单位:度).\n- 可选参数: draw.\n- 点引用圆对象本身, 重跑脚本时按 center + radius·(cosθ, sinθ) 重算, 拖动圆时点会跟着走.'],
    ['CIRCLE_CENTER', 'CIRCLE_CENTER: 创建圆的圆心点.\n- 必须参数: name, circle (或c).\n- 可选参数: draw.\n- 圆心点引用圆对象本身, 重跑脚本时从 circle.center 重新取坐标, 拖动圆时跟着走.'],
    ['PERP_BISECTOR', 'PERP_BISECTOR: 创建两点连线的垂直平分线.\n- 必须参数: name, p1, p2.\n- 可选参数: draw, cutPoints (或 cutoffPoints/cuts).\n- 派生线的两个定义点是内部合成点，没法靠交换定义点删掉某一侧，只能用带方向的截止点（见 LINE 的说明）。'],
    ['PERPENDICULAR', 'PERPENDICULAR: 创建经过指定点且垂直于指定直线的垂线.\n- 必须参数: name, point (或p), line (或l).\n- 可选参数: draw, cutPoints (或 cutoffPoints/cuts).\n- 派生线的两个定义点是内部合成点，没法靠交换定义点删掉某一侧，只能用带方向的截止点（见 LINE 的说明）。'],
    ['PARALLEL', 'PARALLEL: 创建经过指定点且平行于指定直线的平行线.\n- 必须参数: name, point (或p), line (或l).\n- 可选参数: draw, cutPoints (或 cutoffPoints/cuts).\n- 派生线的两个定义点是内部合成点，没法靠交换定义点删掉某一侧，只能用带方向的截止点（见 LINE 的说明）。'],
    ['ANGLE_BISECTOR', 'ANGLE_BISECTOR: 创建一个角的平分线.\n- 必须参数: name, angle (或a, 角对象名称).\n- 可选参数: draw.'],
    ['CIRCUMCIRCLE', 'CIRCUMCIRCLE: 创建三点的外接圆.\n- 必须参数: name, p1, p2, p3.\n- 可选参数: draw.'],
    ['INCIRCLE', 'INCIRCLE: 创建三点的内切圆.\n- 必须参数: name, p1, p2, p3.\n- 可选参数: draw.'],
    ['TANGENT', 'TANGENT: 创建圆的切线.\n- 必须参数: name, circle (或c), point (或p, 圆外或圆上的点).\n- 可选参数: draw.'],
    ['POLYGON', 'POLYGON: 创建多边形.\n- 必须参数: name, points (或p, 顶点列表, 逗号分隔).\n- 可选参数: draw.'],
    ['POINTSET', 'POINTSET: 创建有序点集，供 REGION 组合边界使用.\n- 引用已有点: name, points (或p, 逗号分隔的点名).\n- 按曲线采样: name, curve (或source/obj), start/end (或xstart/xend), step (或dx).\n- 示例: CREATE POINTSET name=top points=L2,L1; CREATE POINTSET name=arc curve=f start=1 end=-1 step=0.1.'],
    ['AXIS', 'AXIS: 精确绘制坐标轴.\n- 最简用法: CREATE AXIS name=axes —— 范围和步长自动贴合当前可见区域, 刻度间距约 64px, 换 VIEW scale 也不用改参数.\n- 可选范围: originX/originY, xMin/xMax, yMin/yMax (不写则自动取可见区域并向外吸附到步长整数倍).\n- 可选步长: xStep/yStep, 或 step 同时设置两者 (不写则按 scale 自动取 1/2/5×10^n 的整数级步长).\n- 可选样式: tickSize (向两侧各画这么长, 总长是两倍), arrowSize, color, labelColor, width, dashed.\n- 可选显示: numbers/showNumbers, arrows/showArrows, bothArrows, origin/showOrigin, labels/axisLabels, xLabel, yLabel, originLabel, fontSize.\n- 默认刻度总长约 10px, 箭头约 13px, 均按屏幕像素换算.\n- 刻度数字标的是「相对原点的偏移」(原点处不标 0), 把 originX/originY 挪到别处即可画第二组坐标系, 数字仍从 0 开始.\n- 示例: CREATE AXIS name=axes; 或 CREATE AXIS name=axes step=1 color=#666666 numbers=true; 上下两组坐标系: CREATE AXIS name=top originX=0 originY=3 xMin=-1 xMax=4 yMin=2.6 yMax=4.3 xStep=1 yStep=1 搭配 CREATE AXIS name=bot originX=0 originY=-1 xMin=-1 xMax=4 yMin=-1.5 yMax=1.5 xStep=1 yStep=1.'],
    ['GRID', 'GRID: 绘制坐标网格.\n- 最简用法: CREATE GRID name=grid —— 范围和步长自动贴合当前可见区域, 与 AXIS 的自动范围一致, 两者不写范围也能对齐.\n- 可选范围: xMin/xMax/yMin/yMax.\n- 可选步长: xStep/yStep, 或 step 同时设置两者.\n- 可选参数: color, width, dashed, numbers/showNumbers, labelColor, fontSize.\n- 示例: CREATE GRID name=grid; 或 CREATE GRID name=grid step=1 color=#eeeeee.'],
    ['REGION', 'REGION: 创建一个可填充区域.\n- 普通区域必须参数: name, boundary (或points/p, 按边界顺序排列的点名, 逗号分隔); 区域自动闭合且不允许边界自交.\n- 点集区域: name, pointSets (或sets/set, 多个点集名逗号分隔); 系统按点集顺序拼接并自动去除相邻重复端点.\n- 圆弓形区域: name, circle, line, side (side=left/right, 按 line.p1 -> line.p2 的方向判断). line 必须是 LINE，且必须与 circle 相交于两个点.\n- 曲线-圆区域: name, curve, circle, side (side=above/below). curve 必须是 y=f(x) 的 CURVE，曲线范围内必须恰有两个交点.\n- 示例: CREATE REGION name=R pointSets=curve_boundary,top_boundary; 或 CREATE REGION name=R boundary=A,B,C,D; 然后使用 FILL.'],
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
    ['CURVE', 'CURVE: 创建一条 y=f(x) 的函数曲线.\n- 必须参数: name, func (函数名, 由 CREATE FUNCTION 定义).\n- 可选参数: xstart/xs, xend/xe (x 的取值范围).\n- 示例: CREATE CURVE name=P func=square xstart=-1 xend=1'],
    ['ANIMATION', 'ANIMATION: 创建动画.\n- 必须参数: name, code (执行的代码块), slot (更新的槽位).\n- 可选参数: interval (毫秒), repeat (布尔值), period (完整周期的帧数，主要用于导出 SVG).\n- 例如: CREATE ANIMATION name=ani interval=50 repeat=true code=frame slot=slot_ani period=40。period=40 表示导出 40 帧后回到完整周期。'],
]);

const metaCommands = ['CLEAR', 'SET', 'HELP', 'VIEW', 'DRAW', 'TEXT', 'FILL', 'MEASURE', 'RUN', 'CODE', 'WITH', 'CALCULATE', 'GETOBJ', 'PRINT', 'CREATE'];
// 几何指令清单只有一份，见 dslCommandNames.ts（以前这里和 dispatch switch 各存一份，漂移过）。
const geometricCommands = GEOMETRIC_COMMANDS;

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
