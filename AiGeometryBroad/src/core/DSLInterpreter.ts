import { LinearObject, type CutSide, type LinearCutPoint } from './geometry/LinearObject';
import {
    GeometricObject,
    type IPoint,
    type DrawOptions,
    Point,
    Circle,
    Ellipse,
    Polygon,
    Region,
    CircularRegion,
    CurveCircleRegion,
    Line,
    Segment,
    Ray,
    Triangle,
    Rectangle,
    Angle,
    PointNativeObject,
    LinearNativeObject,
    Parabola,
    Hyperbola,
    Curve
} from './geometry/types';

import { toScreenPoint, fromScreenPoint, DEFAULT_POINT_RADIUS_PIXELS, resolvePointRadius, type DrawTransform } from './geometry/base';
import {
    buildCanvasMatrix,
    degreesToRadians,
    isUsableView,
    rotateAbout,
    viewPivot,
    type CanvasView,
} from './viewTransform';
import { calculate } from './expression';
import { getHelpMessages } from './HelpCommand';
import { isGeometricCommandName, isMetaCommandName } from './dslCommandNames';
import { splitLatexParts, latexRegionMask } from './latexSplit';
import {
    getCachedKatexCanvas,
    measureKatex,
    prefetchKatexToCanvas,
    renderKatexToSvgFragment,
} from './katexRender';
import type { CustomFunction } from './geometry/types';

// AXIS / GRID 的默认值不再写死逻辑单位，而是按「屏幕上多少像素」换算，
// 这样同一个 CREATE AXIS 在任意 VIEW scale 下都能得到一致的观感。
// 目标刻度间距：约 64 像素一个刻度（数字 12px 时既不挤也不稀）。
const AXIS_TARGET_TICK_PIXELS = 64;
// 默认刻度线总长度 / 箭头长度（屏幕像素）。
// 注意：绘制时刻度是从 origin 向两侧各画 tickSize，所以视觉总长度是 tickSize 的两倍，
// 由「视觉总长度」换算 tickSize 时要除以 2。
const AXIS_TICK_PIXELS = 10;
const AXIS_ARROW_PIXELS = 13;
// 无法拿到可见区域时的兜底半宽（逻辑单位）
const AXIS_FALLBACK_HALF_SPAN = 10;


interface AnimationState {
    name: string; // 动画名称
    code: string; // 动画帧代码名称，这里必须是通过代码块创建的一个代码块
    slot: string;   // 动画槽位名称，动画的当前帧在这个槽位中
    currentFrame: number; // 当前帧索引
    interval: number; // 帧间隔时间（毫秒）；0 表示每个 requestAnimationFrame 都推进一帧
    period?: number; // 可选的完整周期帧数（period 参数）
    isRunning: boolean; // 是否正在运行
    isRepeat: boolean; // 是否循环播放
    // 上一帧实际执行时的时间戳（performance.now 量级）；-1 表示还没跑过第一帧。
    // 调度不再靠每个动画各自的 setTimeout，而是由 onAnimationFrame 的 rAF 循环
    // 用这个字段判断「到点没有」，所以多个动画可以共用一个循环。
    lastFrameTime: number;
}

type onMessageCallback = (level: string, line: number, message: string) => void;
type canvasRedrawNotify = (canvas: HTMLCanvasElement) => void;

export interface VariableInfo {
    name: string;
    expression: string;
    value: number | string | boolean;
    kind: 'fixed' | 'random' | 'object';
    frozen: boolean;
    objectType?: string;
    randomObject?: boolean;
    randomSource?: string;
    // 点自身的 frozen 属性（`CREATE POINT ... frozen=true`）。
    // 与随机对象那种「冻结当前坐标」是两套机制，所以单独给一个字段，
    // 面板据此决定显示哪一个 Freeze 按钮。
    pointFrozen?: boolean;
    // 对象创建指令在脚本中的物理行号（1-based），用于把属性改动写回正确的行。
    lineNumber?: number;
    details?: Record<string, string>;
    editableProperties?: EditableObjectProperty[];
    // 直线/射线/线段的截止点。它是一串「点名 + 方向」，不是数值，
    // 所以不能塞进 editableProperties（那张表只处理数值），单独给一个字段。
    editableCutPoints?: EditableCutPointsProperty;
    // 对象的显示标签。和 editableCutPoints 同理：字符串值 + 可能落在 DRAW 行上，
    // 塞不进只认数值和定义行的 editableProperties。
    editableLabel?: EditableLabelProperty;
}

/**
 * 线性对象的截止点属性。
 *
 * `value` 是可直接写回 `cutPoints=` 的 DSL 片段，例如 `-A,+B`。
 */
export interface EditableCutPointsProperty {
    label: string;
    value: string;
    lineNumber: number;
    editable: boolean;
    reason?: string;
}

/**
 * 对象的显示标签（供属性面板显示 / 编辑）。
 *
 * 值是字符串（可以写中文、写 `$LaTeX$`），所以既不能塞进 editableProperties
 * （那张表只处理数值），也和 editableCutPoints 只是长得像：
 * 标签是**样式**，跟着「真正把对象画出来的那条指令」走，行号不一定是定义行。
 */
export interface EditableLabelProperty {
    label: string;
    /** 当前标签文本（已去引号）。空串表示不显示标签。 */
    value: string;
    /** 要写回的那一行（1-based）：定义行写了 draw=true 就是定义行，否则是 DRAW 行。 */
    lineNumber: number;
    editable: boolean;
    reason?: string;
}

/**
 * 一段画布文字（TEXT）的可编辑信息。
 *
 * 和 `EditableLabelProperty` 分开是因为两者定位方式完全不同：标签靠「对象名 → 定义行」，
 * 而 TEXT 是匿名指令，解释器内部给它合成一个 `text_<行号>` 的名字，真正能定位的只有**行号**。
 * 所以这里直接给出 `lineNumber`，调用方按行号去脚本里原地改写。
 */
export interface EditableTextProperty {
    /** 解释器内部给这段文字合成的名字（`text_<行号>`），仅用于选择/命中标识。 */
    name: string;
    /** 这条 TEXT 指令所在行（1-based）。 */
    lineNumber: number;
    editable: boolean;
    reason?: string;
}

// DSL解释器的主要状态
interface InterpreterState {
    objects: Map<string, GeometricObject>; // 存储所有已定义的几何对象
    codes: Map<string, ParsedCommand[]>; // 存储代码片段
    slots: Map<string, number | string | Boolean>; // 存储槽位对象，分别为key和value
    animations: Map<string, AnimationState>; // 存储动画对象，key为动画名称，value为动画对象
    functions: Map<string, CustomFunction>; // 函数
    lastCodeName: string | undefined; // 上一个代码片段的名称
    canvas?: HTMLCanvasElement;
    ctx?: CanvasRenderingContext2D;
    defaultOptions: {
        canvasX: number;
        canvasY: number;
        width: number;
        height: number;
        geoColor: string;
        labelColor: string;

        centerX: number;
        centerY: number;
        scale: number;
        /**
         * 脚本声明的视图旋转角（**度**，正值 = 屏幕上顺时针），对应 `VIEW rotation=`。
         *
         * 与 scale 一样是「烘进坐标」的基准量：交互式旋转（鼠标拖拽）在它之上再叠一层，
         * 所以重新框选视图（重置视图）只会清掉交互那层，脚本声明的角度仍然保留。
         * 存度而不是弧度，是因为它直接对应 DSL 参数，避免每次读都要换算。
         */
        rotation: number;

        backgroundColor: string;
        penColor: string;
        penSize: number;
        labelFont: string;
        labelSize: number;
        pointRadius: number;
        pointFill: boolean;
        drawLabelForPoints: boolean;
        drawLabelForOthers: boolean;
        // 直线/射线的绘制长度（逻辑单位）。null 表示未指定，
        // 此时只延伸到可视区域边缘，避免无限长的线把导出 SVG 撑得非常大。
        lineLength: number | null;
    },
    onMessage?: onMessageCallback; // 消息回调函数
    contextPreTransformed: boolean; // 渲染上下文是否已自带视图变换
    // 额外的渲染变换：Canvas 由 ctx.setTransform 提供，SVG 导出由这里直接应用
    renderScale: number;
    renderOffsetX: number;
    renderOffsetY: number;
    // SVG 导出路径的交互式旋转角（弧度）。Canvas 路径不用它 —— 那里的旋转
    // 由 applyCanvasViewTransform 写进 ctx 矩阵。
    renderRotation: number;
    // 画布外层矩阵的缩放（来自 setTransform 的 transform.scale）。
    // 用来把默认线宽折算成恒定像素粗细：绘制坐标 -> 屏幕像素的倍率。
    // 只在 contextPreTransformed=true（Canvas 路径）时有意义；SVG 导出取 1。
    outerScale: number;
    // 画布外层矩阵的平移与交互式旋转（来自 setTransform）。三者一起描述
    // 「画布中心 + 旋转 · (outerScale · 变换前坐标 + 平移)」这个外层相似变换，
    // 单独拆出来存是因为旋转的轴心要按 canvas 尺寸算，不能在 setTransform 里丢掉。
    outerPanX: number;
    outerPanY: number;
    outerRotation: number;
    animationAutoStart: boolean; // 是否自动启动动画计时器
    variableInfo: Map<string, VariableInfo>; // 用户可见的变量信息
    frozenRandomValues: Map<string, number>; // 固定后的随机变量值
    frozenRandomObjects: Map<string, { x: number; y: number }>; // 固定后的随机对象坐标
    randomObjectSources: Map<string, string>; // 随机对象的创建来源
    selectedObjectName?: string; // 当前主选中对象（兼容旧接口）
    selectedObjectNames: Set<string>; // 当前多选对象
    selectedLabelId?: string; // 当前选中标签
    labelPositions: Map<string, IPoint>; // 用户拖动后的标签逻辑坐标
    /**
     * 「对象名 -> 标签文本」映射，由 `SETLABEL` 指令写入。
     *
     * 为什么要单独存一份：标签文本原本**不是对象自身属性**，它只活在脚本源码的
     * `label=` 参数里，靠 `PendingDraw.label` / `params.get('label')` 在绘制时临时传递，
     * 画完就丢。于是「按名字给任意对象设标签」这件事没有落脚点 ——
     *   - 派生对象（TANGENT 的 T2 / T2_tan、自动命名的 seg_2 …）在脚本里根本没有
     *     独立定义行，`sourceBindings` 里查不到，既读不到也写不回去；
     *   - 想在脚本里加标签也因为找不到「该写哪一行」而作罢。
     * 这张表就是那个落脚点：绘制时按名字查，查到了就覆盖脚本里的 `label=`。
     *
     * 值是已解析的最终文本；空串表示「显式要求不显示标签」（而不是「没设置」），
     * 所以用 `has()` 判断是否存在，不能拿 `get() === ''` 当没设置。
     */
    labelOverrides: Map<string, string>;
    labelHitRegions: LabelHitRegion[];
    textHitRegions: TextHitRegion[];
    renderedObjectNames: string[];
    sourceBindings: Map<string, SourceBinding>;
    /**
     * 全部顶层指令的解析结果（CODE 块里的不算）。
     * sourceBindings 只收「带 name 的定义指令」，而删除对象还要找 DRAW / FILL / MEASURE
     * 这类不建对象、只引用对象的指令，所以单独留一份完整列表。
     */
    topLevelCommands: ParsedCommand[];
    previewObjectProperties: Map<string, Map<ObjectPropertyKey, number>>;
    textElements: Map<string, TextElement>;
    pointSets: Map<string, Point[]>;
    /** 当前正在执行的指令行号，供「事后才发现的错误」在消息里报出准确位置。 */
    currentCommandLine: number;
    /**
     * 「create 时写了 draw=true」的几何对象，等脚本跑完统一绘制。
     *
     * 用数组保序：绘制顺序 = 创建顺序，所以 z 序与「逐个立即绘制」时一致。
     * 统一后置的原因见 `collectDraw`。
     */
    pendingDraws: PendingDraw[];
    /**
     * 创建时还没解析出来的截止点引用，按对象名索引。
     *
     * 和绘制是**两件独立的事**：即使这条线这次不画（`draw=false`），引用也要补全，
     * 否则后面 `DRAW obj=X` 把它画出来时截止点是缺的。所以单独放一份。
     */
    pendingCutResolutions: Map<string, PendingCutResolution>;
    /** executeLines 的嵌套深度，只有回到最外层才冲刷待绘队列。 */
    executeDepth: number;
}

/** 一个「create 时写了 draw=true」、等着脚本跑完统一绘制的几何对象。 */
interface PendingDraw {
    /** 绘制参数（创建时那一行的副本）。 */
    params: Map<string, string>;
    object: GeometricObject;
    /** 点的标签名（`drawObject` 需要），非点对象是 undefined。 */
    label: string | undefined;
}

/** 一个创建时引用了尚未定义的点的线性对象。 */
interface PendingCutResolution {
    object: LinearObject;
    /** 解析失败的截止点引用（点名 + 方向）。 */
    cuts: Array<{ name: string; side: CutSide }>;
    lineNumber: number;
}

export type ObjectPropertyKey = 'x' | 'y' | 'radius' | 'radiusX' | 'radiusY' | 'rotation' | 'width' | 'height';

export interface EditableObjectProperty {
    key: ObjectPropertyKey;
    label: string;
    value: number;
    lineNumber: number;
    editable: boolean;
    reason?: string;
}

/**
 * 一条顶层指令的解析结果。给「改写脚本」用：删除对象、裁剪线性对象都要靠它
 * 定位「哪一行定义了谁、哪一行引用了谁」。
 */
export interface TopLevelCommandInfo {
    /** 指令名，已大写（POINT / DRAW / LINE ...）。 */
    command: string;
    type: 'meta' | 'geometric';
    /** 解析好的参数表，值已去掉引号。 */
    params: Map<string, string>;
    /** 该指令在脚本里的真实物理行号（1-based）。 */
    lineNumber: number;
}

interface SourceBinding {
    command: ParsedCommand;
    lineNumber: number;
}

// 解析后的指令接口
interface ParsedCommand {
    type: 'meta' | 'geometric';
    command: string;
    params: Map<string, string>;
    rawCommand: string;
    lineNumber: number; // 原始行内容
}

interface LabelHitRegion {
    id: string;
    objectName: string;
    x: number;
    y: number;
    width: number;
    height: number;
    position: IPoint;
}

interface TextHitRegion {
    objectName: string;
    x: number;
    y: number;
    width: number;
    ascent: number;
    descent: number;
}

interface TextElement {
    name: string;
    text: string;
    x: number;
    y: number;
    width: number;
    ascent: number;
    descent: number;
    lineNumber: number;
}

export type CanvasSelection =
    | { kind: 'object'; name: string }
    | { kind: 'label'; id: string; objectName: string; position: IPoint; screenAnchor: IPoint }
    | null;

const SELECTED_OBJECT_COLOR = '#e11d48';

/**
 * 能产生线性对象、并且接受 `cutPoints` 的创建指令。
 *
 * 派生线（中垂线 / 垂线 / 平行线 / 角平分线）的两个定义点是内部合成点，DSL 里引用不到，
 * 所以它们只能靠「带方向的截止点」删掉某一侧 —— 这正是这个白名单存在的理由：
 * 只要指令在这里，属性面板就会给出截止点输入框，右键截取也能写回原定义行。
 */
const LINEAR_CUT_COMMANDS = new Set([
    'LINE', 'SEGMENT', 'RAY',
    'PERP_BISECTOR', 'PERPENDICULAR', 'PARALLEL', 'ANGLE_BISECTOR',
]);

/** 把一个截止点写成 DSL 片段：`+A`（砍正方向）/ `-A`（砍负方向）/ `A`（不带方向）。 */
export function formatLinearCutPoint(cut: LinearCutPoint): string {
    const prefix = cut.side === 'right' ? '+' : cut.side === 'left' ? '-' : '';
    return `${prefix}${cut.point.name}`;
}

// 几何作图DSL解释器
export class GeometryDSLInterpreter {
    private state: InterpreterState;
    private zeroThresholdValue: number = 1e-6;
    // 当前挂起的动画帧回调。浏览器是 requestAnimationFrame，Node 是 setTimeout。
    // 全解释器只有一个，所有动画共用一个循环，不再每个动画挂一条定时器链。
    private scheduledFrame: { cancel: () => void } | null = null;

    constructor(canvas?: HTMLCanvasElement, onMessage?: onMessageCallback) {
        this.state = {
            objects: new Map(),
            codes: new Map(),
            slots: new Map(),
            animations: new Map(),
            functions: new Map(),
            lastCodeName: undefined,
            canvas,
            ctx: canvas?.getContext('2d') || undefined,
            defaultOptions: {
                canvasX: 0,
                canvasY: 0,
                width: canvas ? canvas.width : 0,
                height: canvas ? canvas.height : 0,
                geoColor: 'black',
                // 默认标签色必须是黑，不能是白。
                // 画布默认底色是白的（见下面的 backgroundColor），白字画在白底上等于隐形 ——
                // 用户写 `CREATE POINT ... draw=true label=P` 会发现「标签明明加了却看不见」。
                // 文档（CLEAR 的 labelColor 说明）一直写的也是 black，这里是代码没跟上文档。
                // 想在深色底上要白字，显式写 `labelColor=white` 或 `SET labelColor=white`。
                labelColor: 'black',

                centerX: 0,
                centerY: 0,
                scale: 1,
                rotation: 0,

                backgroundColor: 'white',
                penColor: 'black',
                penSize: 1,
                labelFont: '12px Arial',
                labelSize: 12,
                // 默认点半径。必须是 DEFAULT_POINT_RADIUS_PIXELS（4）—— 这就是历史上
                // 「不写 radius= 的点」实际用的值，接上 SET item=pointRadius 后默认行为不能变。
                pointRadius: DEFAULT_POINT_RADIUS_PIXELS,
                // 默认点是否实心。历史行为是「不写 real= 就是空心点」，所以默认 false；
                // （解释器自己算出来的点走 Point 构造函数的 real=true，不受这里影响。）
                pointFill: false,
                drawLabelForPoints: true,
                drawLabelForOthers: false,
                lineLength: null,
            },
            onMessage: onMessage,
            // Canvas 路径默认认为上下文已带变换，保持既有行为
            contextPreTransformed: true,
            renderScale: 1,
            renderOffsetX: 0,
            renderOffsetY: 0,
            renderRotation: 0,
            outerScale: 1,
            outerPanX: 0,
            outerPanY: 0,
            outerRotation: 0,
            animationAutoStart: true,
            variableInfo: new Map(),
            frozenRandomValues: new Map(),
            frozenRandomObjects: new Map(),
            randomObjectSources: new Map(),
            selectedObjectName: undefined,
            selectedObjectNames: new Set(),
            selectedLabelId: undefined,
            labelPositions: new Map(),
            labelOverrides: new Map(),
            labelHitRegions: [],
            textHitRegions: [],
            renderedObjectNames: [],
            sourceBindings: new Map(),
            topLevelCommands: [],
            previewObjectProperties: new Map(),
            textElements: new Map(),
            pointSets: new Map(),
            currentCommandLine: 0,
            pendingDraws: [],
            pendingCutResolutions: new Map(),
            executeDepth: 0,
        };
    }

    private addCommand(name: string, rawLine: string, command: ParsedCommand | null, lineNumber: number): void {
        if (!command) {
            console.error(`Failed to parse code block at line ${lineNumber}: ${rawLine}`);
            this.state.onMessage?.('error', lineNumber, `Failed to parse code block at line ${lineNumber}: ${rawLine}`);

            return;
        }

        this.state.codes.get(name)?.push({
            type: command.type,
            command: command.command,
            params: command.params,
            rawCommand: rawLine,
            lineNumber: lineNumber
        });
    }

    private recordSourceBinding(command: ParsedCommand): void {
        const commandName = command.command.toUpperCase();
        if (commandName === 'TEXT') {
            const name = command.params.get('name') || command.params.get('id') || `text_${command.lineNumber}`;
            this.state.sourceBindings.set(name, { command, lineNumber: command.lineNumber });
            return;
        }
        const name = command.params.get('name') || command.params.get('n');
        if (!name || command.type !== 'geometric') return;
        this.state.sourceBindings.set(name, { command, lineNumber: command.lineNumber });
    }

    private getTextObjectName(params: Map<string, string>, lineNumber: number): string {
        return params.get('name') || params.get('id') || `text_${lineNumber}`;
    }

    private executeLines(lines: LogicalLine[], setLineNumber: boolean): void {
        // 只有回到最外层才把收集到的几何对象画出来：RUN / WITH / 动画帧会递归调用到这里，
        // 内层提前画就看不到后面才定义的点（截止点、交点都是前向引用）。
        // 这也相当于脚本末尾隐式补了一条 `DRAW`。
        this.state.executeDepth++;
        try {
            // 最外层执行前先把画布视图矩阵写好（含旋转）。动画逐帧也走这里，
            // 所以拖动旋转之后动画帧的位置同样是对的，不需要各自记着设矩阵。
            if (this.state.executeDepth === 1) this.applyCanvasViewTransform();
            this.executeLinesInner(lines, setLineNumber);
        } finally {
            this.state.executeDepth--;
            if (this.state.executeDepth === 0) this.flushPendingDraws();
        }
    }

    private executeLinesInner(lines: LogicalLine[], setLineNumber: boolean): void {
        for (let i = 0; i < lines.length; i++) {
            const entry = lines[i];
            // entry.line 是这条逻辑指令在原始脚本中的物理行号。
            // 空行/注释/跨行引号/行末续行都只影响逻辑行的合并，不再影响行号，
            // 因此上报给 UI 的行号与编辑器里看到的一致。
            const lineNumber = entry.line;
            const line = entry.text.trim();

            // 跳过空行和注释
            if (!line || line.startsWith('#')) {
                continue;
            }

            // 以[开头的行表示代码片段，以]结尾的行表示代码片段结束
            if (line.startsWith('[')) {
                // 不允许在代码块中再包含代码块
                if (!setLineNumber) {
                    console.error(`Nested code blocks are not allowed at line ${lineNumber}: ${line}`);
                    this.state.onMessage?.('error', lineNumber, `Nested code blocks are not allowed at line ${lineNumber}: ${line}`);
                }

                // 使用lastCodeName创建代码段
                const code = line.slice(1).trim();

                if (this.state.lastCodeName && code) {
                    const command = this.parseLine(line, setLineNumber ? lineNumber : -1);
                    this.addCommand(this.state.lastCodeName, line, command, lineNumber);
                }
                continue;
            } else if (line.endsWith(']')) {
                // 代码片段结束
                this.state.lastCodeName = undefined;
                continue;
            }

            try {
                if (this.state.lastCodeName) {
                    // 如果当前行在代码片段中，添加到当前代码片段
                    const command = this.parseLine(line, setLineNumber ? lineNumber : -1);
                    this.addCommand(this.state.lastCodeName, line, command, lineNumber);
                } else {
                    // 否则执行当前行指令，同时建立“对象名 -> 创建命令”的源代码映射。
                    const command = this.parseLine(line, setLineNumber ? lineNumber : -1);
                    if (command) {
                        this.state.topLevelCommands.push(command);
                        this.recordSourceBinding(command);
                        this.executeCommand(command);
                    }
                }

            } catch (error) {
                console.error(`Error executing line ${lineNumber}: ${line}`, error);
                this.state.onMessage?.('error', lineNumber, `Error executing line ${lineNumber}: ${line} - ${error}`);
            }
        }
    }

    // 主要的解析和执行函数
    public execute(script: string): void {
        // 清空state中的命令和slot
        this.state.codes.clear();
        // 脚本重跑会重建全部动画，先停掉驱动循环，否则旧循环会继续空转。
        this.cancelScheduledFrame();
        this.state.animations.clear();
        this.state.lastCodeName = undefined;
        this.state.objects.clear();
        this.state.slots.clear();
        this.state.functions.clear();
        this.state.variableInfo.clear();
        this.state.sourceBindings.clear();
        this.state.topLevelCommands = [];
        this.state.textElements.clear();
        this.state.pointSets.clear();
        // 标签覆盖表由 SETLABEL 写入，而脚本里就写着 SETLABEL，重跑会重新填一遍。
        // 不全清的话，用户把 SETLABEL 那行删掉后旧标签会阴魂不散地留在图上。
        this.state.labelOverrides.clear();
        this.state.labelHitRegions = [];
        this.state.textHitRegions = [];
        this.state.renderedObjectNames = [];
        // 对象被清空，上一轮收集的待绘对象与未解析的截止点引用也随之作废。
        this.state.pendingDraws = [];
        this.state.pendingCutResolutions.clear();
        this.state.executeDepth = 0;

        const lines = buildLogicalLines(script);
        this.executeLines(lines, true);
    }

    public setTransform(canvas: HTMLCanvasElement, transform: { x: number; y: number; scale: number; rotation?: number }) {
        this.state.canvas = canvas;

        // 记住外层矩阵的缩放，默认线宽靠它折算回恒定像素粗细。
        // scale 为 0 / 非法时退回 1，避免后面算出 Infinity。
        const scale = Number.isFinite(transform.scale) && Math.abs(transform.scale) > this.zeroThresholdValue
            ? transform.scale
            : 1;
        this.state.outerScale = scale;
        this.state.outerPanX = Number.isFinite(transform.x) ? transform.x : 0;
        this.state.outerPanY = Number.isFinite(transform.y) ? transform.y : 0;
        this.state.outerRotation = Number.isFinite(transform.rotation) ? (transform.rotation as number) : 0;

        // 计算变换以后左上角的坐标
        this.state.defaultOptions.canvasX = -this.state.outerPanX / scale;
        this.state.defaultOptions.canvasY = -this.state.outerPanY / scale;

        // 计算变换后的宽高
        this.state.defaultOptions.width = canvas.width / scale;
        this.state.defaultOptions.height = canvas.height / scale;
    }

    /**
     * 脚本声明的视图旋转（弧度）。`VIEW rotation=` 的角度在这里换算一次，
     * 其余地方一律用弧度，免得度/弧度在若干处反复来回换算而走偏。
     */
    private getDeclaredRotationRadians(): number {
        const degrees = this.state.defaultOptions.rotation;
        return Number.isFinite(degrees) ? degreesToRadians(degrees) : 0;
    }

    /** 总旋转角 = 脚本声明的 + 交互式拖拽的。渲染、命中、坐标反算必须共用这一个值。 */
    private getTotalRotationRadians(interactiveRotation = 0): number {
        return this.getDeclaredRotationRadians()
            + (Number.isFinite(interactiveRotation) ? interactiveRotation : 0);
    }

    /**
     * 当前可见区域在「渲染坐标」里的范围。
     *
     * - Canvas 路径：可见区就是外层矩阵的**变换前**范围 —— θ=0 时正是 setTransform 算好的
     *   canvasX/canvasY/width/height；有旋转时把画布四角反旋转回变换前坐标再取包围盒。
     * - SVG 路径：坐标已经是最终输出坐标，「可见区」是整块画布；有旋转时同样取包围盒。
     *
     * 有旋转时返回的是**轴对齐包围盒**，比真实可见区略大。这只影响无限长直线、射线、
     * 坐标轴、网格往外延伸多远，不会把可见部分裁掉 —— 是刻意的保守取法。
     */
    private getVisibleViewRect(): { x: number; y: number; width: number; height: number } {
        const opts = this.state.defaultOptions;
        const canvas = this.state.canvas;
        const width = canvas?.width || opts.width;
        const height = canvas?.height || opts.height;
        const angle = this.getTotalRotationRadians();

        const aabb = (points: IPoint[]) => {
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            for (const point of points) {
                minX = Math.min(minX, point.x);
                minY = Math.min(minY, point.y);
                maxX = Math.max(maxX, point.x);
                maxY = Math.max(maxY, point.y);
            }
            return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
        };

        if (!this.state.contextPreTransformed) {
            if (!angle) return { x: 0, y: 0, width, height };
            const pivot = viewPivot(width, height);
            return aabb([
                rotateAbout({ x: 0, y: 0 }, pivot, angle),
                rotateAbout({ x: width, y: 0 }, pivot, angle),
                rotateAbout({ x: 0, y: height }, pivot, angle),
                rotateAbout({ x: width, y: height }, pivot, angle),
            ]);
        }

        if (!angle) {
            return { x: opts.canvasX, y: opts.canvasY, width: opts.width, height: opts.height };
        }
        const pivot = viewPivot(width, height);
        const scale = this.state.outerScale;
        return aabb([
            { x: 0, y: 0 },
            { x: width, y: 0 },
            { x: 0, y: height },
            { x: width, y: height },
        ].map(corner => {
            const unrotated = rotateAbout(corner, pivot, -angle);
            return {
                x: (unrotated.x - this.state.outerPanX) / scale,
                y: (unrotated.y - this.state.outerPanY) / scale,
            };
        }));
    }

    /**
     * 把画布外层矩阵（平移 / 缩放 / 旋转）写进 ctx。
     *
     * 为什么由解释器来做、而不是让调用方在 setTransform 时设好：
     * 总旋转角要同时叠加 `VIEW rotation=`（脚本里）和交互式旋转（画布组件里），
     * 两边各持一半，只有解释器两边都看得到。脚本里改一次 VIEW，这里下一帧就是对的，
     * 不会出现「画布算好矩阵之后脚本才改旋转」的一帧错位。
     */
    private applyCanvasViewTransform(): void {
        const ctx = this.state.ctx;
        const canvas = this.state.canvas;
        if (!ctx || !canvas || !this.state.contextPreTransformed) return;
        const matrix = buildCanvasMatrix({
            x: this.state.outerPanX,
            y: this.state.outerPanY,
            scale: this.state.outerScale,
            rotation: this.state.outerRotation,
        }, canvas.width, canvas.height, this.getDeclaredRotationRadians());
        ctx.setTransform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
    }

    // 设置视图中心的逻辑坐标（供 SVG 导出等非交互渲染使用）
    public setViewCenter(centerX: number, centerY: number): void {
        this.state.defaultOptions.centerX = centerX;
        this.state.defaultOptions.centerY = centerY;
    }

    // 声明渲染上下文是否已自带视图变换。
    // - Canvas 路径：上下文已经 setTransform(scale/平移)，标签坐标必须传给内部换算后再交给 canvas 二次变换。
    // - SVG 导出路径：上下文没有预置变换，标签坐标必须自己完成完整换算。
    // 不设置这个开关，两条路径至少有一条会出现标签错位。
    public setContextPreTransformed(preTransformed: boolean): void {
        this.state.contextPreTransformed = preTransformed;
    }

    // 设置 SVG 等无预置 Canvas 变换场景的额外渲染变换。
    // Canvas 模式保持默认值（1, 0, 0），由 ctx.setTransform 提供缩放和平移。
    public setRenderTransform(transform: { scale: number; offsetX: number; offsetY: number; rotation?: number }): void {
        const scale = Number.isFinite(transform.scale) && Math.abs(transform.scale) > this.zeroThresholdValue
            ? transform.scale
            : 1;
        this.state.renderScale = scale;
        this.state.renderOffsetX = Number.isFinite(transform.offsetX) ? transform.offsetX : 0;
        this.state.renderOffsetY = Number.isFinite(transform.offsetY) ? transform.offsetY : 0;
        // SVG 导出没有外层矩阵，交互式旋转只能在这里并入坐标。
        this.state.renderRotation = Number.isFinite(transform.rotation) ? (transform.rotation as number) : 0;

        // 外部变换由解释器直接应用时，绘制坐标已经是 SVG/屏幕坐标；
        // 可视区域和 CLEAR 背景都应覆盖完整的虚拟画布。
        if (this.state.ctx && !this.state.contextPreTransformed) {
            this.state.defaultOptions.canvasX = 0;
            this.state.defaultOptions.canvasY = 0;
            this.state.defaultOptions.width = this.state.canvas?.width || this.state.defaultOptions.width;
            this.state.defaultOptions.height = this.state.canvas?.height || this.state.defaultOptions.height;
        }
    }

    public setSelectedObjectName(name: string | null): void {
        this.state.selectedObjectName = name || undefined;
        this.state.selectedObjectNames = name ? new Set([name]) : new Set();
    }

    public setSelectedObjectNames(names: string[]): void {
        this.state.selectedObjectNames = new Set(names.filter(Boolean));
        this.state.selectedObjectName = names[names.length - 1] || undefined;
    }

    public setSelectedLabelId(id: string | null): void {
        this.state.selectedLabelId = id || undefined;
    }

    public setLabelPositions(positions: Record<string, IPoint>): void {
        this.state.labelPositions = new Map(
            Object.entries(positions).map(([id, position]) => [id, { x: position.x, y: position.y }]),
        );
    }

    // 导出等离线场景可以关闭自动播放，再通过 stepAnimation 逐帧采样
    public setAnimationAutoStart(autoStart: boolean): void {
        this.state.animationAutoStart = autoStart;
        if (autoStart) {
            // 打开时若已有动画在跑，立刻接管驱动；离线导出场景此时还没有动画，不会启动。
            if (Array.from(this.state.animations.values()).some(animation => animation.isRunning)) {
                this.startAnimationLoop();
            }
        } else {
            this.cancelScheduledFrame();
        }
    }

    // 停掉驱动循环并结束所有动画。
    // 组件卸载 / 丢弃解释器实例时调用：否则 rAF 循环会继续对已经脱离文档的 canvas 绘制。
    public dispose(): void {
        this.cancelScheduledFrame();
        for (const animation of this.state.animations.values()) {
            animation.isRunning = false;
        }
    }

    public setFrozenRandomVariables(values: Record<string, number>): void {
        this.state.frozenRandomValues = new Map(Object.entries(values));
    }

    public setFrozenRandomObjects(values: Record<string, { x: number; y: number }>): void {
        this.state.frozenRandomObjects = new Map(Object.entries(values));
    }

    public getVariables(): VariableInfo[] {
        const variables = Array.from(this.state.variableInfo.values()).map(variable => ({ ...variable }));
        const objects = Array.from(this.state.objects.values()).map(object => {
            const randomSource = this.state.randomObjectSources.get(object.name);
            const pointFrozen = object.type === 'point' && (object as Point).frozen === true;
            // 随机对象用「冻结当前坐标」那套；普通点用脚本里的 frozen 属性。
            const frozen = randomSource
                ? this.state.frozenRandomObjects.has(object.name)
                : pointFrozen;
            return {
                name: object.name,
                expression: randomSource || object.type,
                value: object.type,
                kind: 'object' as const,
                frozen,
                objectType: object.type,
                randomObject: Boolean(randomSource),
                randomSource,
                pointFrozen,
                lineNumber: this.getSourceLineForObject(object.name) ?? undefined,
                details: this.getObjectDetails(object),
                editableProperties: this.getEditableObjectProperties(object.name),
                editableCutPoints: this.getEditableCutPoints(object.name),
                editableLabel: this.getEditableLabel(object.name),
            };
        });
        const texts = Array.from(this.state.textElements.values()).map(text => ({
            name: text.name,
            expression: 'TEXT',
            value: 'text',
            kind: 'object' as const,
            frozen: false,
            objectType: 'text',
            lineNumber: this.getSourceLineForObject(text.name) ?? undefined,
            details: {
                type: 'text',
                'position.x': this.formatObjectNumber(text.x),
                'position.y': this.formatObjectNumber(text.y),
                text: text.text,
            },
            editableProperties: this.getEditableObjectProperties(text.name),
        }));
        return [...variables, ...objects, ...texts];
    }

    /**
     * 渲染时在内存里维护的“代码行 <-> 对象”映射：
     * 返回该对象创建指令在原始脚本中的真实物理行号（1-based）。
     * 空行、注释、跨行引号值和行末续行都不会影响这个行号。
     */
    public getSourceLineForObject(name: string): number | null {
        const binding = this.state.sourceBindings.get(name);
        if (!binding || !(binding.lineNumber > 0)) return null;
        return binding.lineNumber;
    }

    /**
     * 顶层指令（CODE 块里的除外）的解析结果，供**脚本改写**使用。
     *
     * 删除对象、把直线/射线裁剪成线段，这两件事都是「改写脚本」而不是「追加指令」，
     * 需要知道每条指令定义或引用了哪些对象。这里直接交出解释器已经解析好的参数表，
     * 免得再写第二个手写参数扫描器 —— `parseParameters` 那套引号 / 空值 / 行尾注释
     * 规则很容易抄错，而抄错的后果是改坏用户的脚本。
     *
     * 只收顶层指令：CODE 块里的对象没有稳定的源码行，本来也不该被脚本改写碰到。
     */
    public getTopLevelCommands(): ReadonlyArray<TopLevelCommandInfo> {
        return this.state.topLevelCommands.map(entry => ({
            command: entry.command,
            type: entry.type,
            // 复制一份，调用方拿去做字符串拼接，别让它有机会改到解释器的内部状态。
            params: new Map(entry.params),
            lineNumber: entry.lineNumber,
        }));
    }

    public getEditableObjectProperties(name: string): EditableObjectProperty[] {
        const binding = this.state.sourceBindings.get(name);
        if (!binding) return [];

        const command = binding.command.command.toUpperCase();
        const propertyKeys: Array<{ key: ObjectPropertyKey; label: string; aliases: string[] }> =
            command === 'TEXT'
                ? [
                    { key: 'x', label: '位置 X', aliases: ['x'] },
                    { key: 'y', label: '位置 Y', aliases: ['y'] },
                ]
                : command === 'POINT'
                ? [
                    { key: 'x', label: '位置 X', aliases: ['x'] },
                    { key: 'y', label: '位置 Y', aliases: ['y'] },
                    { key: 'radius', label: '半径', aliases: ['radius', 'r'] },
                ]
                : command === 'CIRCLE'
                    ? [{ key: 'radius', label: '半径', aliases: ['radius', 'r'] }]
                    : command === 'ELLIPSE'
                        ? [
                            { key: 'radiusX', label: '半径 X', aliases: ['radiusX', 'rx'] },
                            { key: 'radiusY', label: '半径 Y', aliases: ['radiusY', 'ry'] },
                            { key: 'rotation', label: '旋转角', aliases: ['rotation', 'angle'] },
                        ]
                        : command === 'RECTANGLE'
                            ? [
                                { key: 'width', label: '宽度', aliases: ['width', 'w'] },
                                { key: 'height', label: '高度', aliases: ['height', 'h'] },
                            ]
                            : [];

        return propertyKeys.flatMap(({ key, label, aliases }) => {
            const raw = aliases.map(alias => binding.command.params.get(alias)).find(value => value !== undefined);
            const value = raw === undefined ? undefined : Number(raw);
            if (value === undefined || !Number.isFinite(value)) return [];
            const isLiteral = this.isLiteralNumber(raw!);
            return [{
                key,
                label,
                value: this.getPreviewProperty(name, key) ?? value,
                lineNumber: binding.lineNumber,
                editable: isLiteral,
                reason: isLiteral ? undefined : '该属性由槽位或表达式驱动，请先在代码中改为数值。',
            }];
        });
    }

    /**
     * 线性对象的截止点属性（供属性面板显示 / 编辑）。
     *
     * 只在「这条线的定义指令确实支持 `cutPoints`」时返回。画布上还有大量线性对象
     * 来自 CODE 块或内部构造（`L_pb_<mid>` 这类合成点），它们没有稳定的源码行，
     * 改定义行没有意义，所以直接不显示。
     */
    public getEditableCutPoints(name: string): EditableCutPointsProperty | undefined {
        const object = this.state.objects.get(name);
        if (!(object instanceof LinearObject)) return undefined;
        const binding = this.state.sourceBindings.get(name);
        if (!binding || !LINEAR_CUT_COMMANDS.has(binding.command.command.toUpperCase())) return undefined;

        // 优先显示脚本里原本写的那串：它可能引用了还没定义的点（这种引用不会进 cutPoints），
        // 按解析结果重建会把那部分悄悄丢掉，用户一改就把代码里的写法覆盖没了。
        const raw = binding.command.params.get('cutPoints')
            ?? binding.command.params.get('cutoffPoints')
            ?? binding.command.params.get('cuts');

        return {
            label: '截止点',
            value: raw !== undefined
                ? raw.trim()
                : object.cutPoints.map(formatLinearCutPoint).join(','),
            lineNumber: binding.lineNumber,
            editable: true,
            reason: '写 +A 隐藏 A 的正方向一侧，写 -A 隐藏负方向一侧；-A,+B 把直线截成线段 [A,B]',
        };
    }

    /**
     * 找出「这个对象的标签该挂在哪儿」。
     *
     * 标签是样式，跟着真正把对象画出来的指令走：
     *   1. 定义行自己就画（`draw=true`）→ 定义行；
     *   2. 否则找把它画出来的 `DRAW obj=X`（`DRAW obj=A,B` 要拆开比）→ 那一条 DRAW；
     *   3. 都没有 → 对象根本没画出来，标签挂哪儿都不会显示，返回 null。
     *
     * 读和写必须用同一个来源：如果显示时读定义行、写回时写到 DRAW 行，用户就会看到
     * 「面板里明明写着 A，画布上却是 B」，看起来完全像个 bug。
     */
    private resolveLabelSource(name: string): { lineNumber: number; params: Map<string, string>; onDrawLine: boolean } | null {
        const binding = this.state.sourceBindings.get(name);
        if (!binding) return null;

        // **DRAW 行优先**，顺序和 `updateDslObjectLabel` 必须一致 ——
        // 那边按同样优先级决定把 `label=` 写在哪一行，两边不一致就会出现
        // 「面板里显示 A、画布上是 B」。定义行只要有 `name=` 就能匹配，若让它抢先，
        // 一条没写 `draw=true` 的定义行就会把真正的 DRAW 行遮住。
        for (const entry of this.state.topLevelCommands) {
            if (entry.command.toUpperCase() !== 'DRAW') continue;
            const target = entry.params.get('obj') ?? entry.params.get('o');
            if (!target) continue;
            if (target.split(',').some(item => item.trim() === name)) {
                return { lineNumber: entry.lineNumber, params: entry.params, onDrawLine: true };
            }
        }

        if ((binding.command.params.get('draw') ?? '').toLowerCase() === 'true') {
            return { lineNumber: binding.lineNumber, params: binding.command.params, onDrawLine: false };
        }

        return null;
    }

    /**
     * 对象的标签属性（供属性面板显示 / 编辑）。
     *
     * 只在「这个对象确实被画出来了」时给编辑入口 —— 画都没画出来，标签写哪儿都不会
     * 显示，给一个能改的输入框只会让人以为坏了。这种情况仍然返回一条记录，
     * 把原因写在 reason 里，面板据此把输入框置灰。
     */
    public getEditableLabel(name: string): EditableLabelProperty | undefined {
        if (!this.state.objects.has(name)) return undefined;

        // `SETLABEL` 设过的对象：值以覆盖表为准，且**永远可编辑** ——
        // 它不依赖脚本里有没有可改的 `label=`，这正是 SETLABEL 存在的意义。
        if (this.state.labelOverrides.has(name)) {
            return {
                label: '标签',
                value: this.state.labelOverrides.get(name) ?? '',
                // 覆盖表没有对应源码行；给定义行（若有）只是为了面板能显示「第 N 行」。
                lineNumber: this.state.sourceBindings.get(name)?.lineNumber ?? 0,
                editable: true,
                reason: '由 SETLABEL 指令设置。清空 = 不显示标签；想彻底去掉这行请删除脚本里的 SETLABEL。',
            };
        }

        const binding = this.state.sourceBindings.get(name);

        // 没有源码行定义的对象：TANGENT 顺带建出的切点/切线（`T2`、`T2_tan`）、
        // 自动命名的派生对象（`seg_2`）等。它们**在脚本里没有独立的定义行**，
        // 所以既读不到也写不回 `label=` —— 但用户完全有理由想给它加标签。
        // 这种情况引导他用 SETLABEL；仍然可编辑（写入覆盖表）。
        if (!binding) {
            return {
                label: '标签',
                value: '',
                lineNumber: 0,
                editable: true,
                reason: '这个对象是自动派生的（没有单独的创建行），标签会用 SETLABEL 指令写入脚本。',
            };
        }

        const source = this.resolveLabelSource(name);
        if (!source) {
            // 有定义行但没画出来。以前这里是 editable:false，逼着用户先去 `draw=true`；
            // 现在有 SETLABEL 作为第二条路 —— 它按名字设标签，不要求对象在脚本里有落脚点。
            return {
                label: '标签',
                value: '',
                lineNumber: binding.lineNumber,
                editable: true,
                reason: '这个对象还没有被画出来（定义行没有 draw=true，也没有 DRAW 指令）。标签会用 SETLABEL 指令写入脚本。',
            };
        }

        // `l` 只在 DRAW 行上当标签别名：定义行上 `l` 在 PERPENDICULAR_FOOT / REGION
        // 里是「线」的意思，读错了会把线名当成标签显示出来。
        const value = source.params.get('label')
            ?? (source.onDrawLine ? source.params.get('l') : undefined)
            ?? '';

        return {
            label: '标签',
            value,
            lineNumber: source.lineNumber,
            editable: true,
            reason: '留空表示不显示标签。标签写在脚本的 label= 上，可以写中文或 $LaTeX$。',
        };
    }

    /**
     * 一段画布文字（TEXT）的可编辑信息。
     *
     * TEXT 的定位只有**行号**这一个可靠依据：它没有 `name=`，解释器内部合成
     * `text_<行号>` 只是为了让选择和命中测试有个标识。所以这里从 `topLevelCommands`
     * 里找那条 TEXT 指令的行号 —— 那份表是解释器解析脚本时留下的，比从
     * `textElements` 反推更可靠（TEXT 会被延迟到末尾统一绘制，元素上的行号未必是定义行）。
     *
     * 找不到时返回 `editable: false` 并给出原因：文字可能来自 CODE 块 / 动画帧，
     * 那些上下文里的指令没有稳定的顶层源码行，硬改会改错地方。
     */
    public getEditableText(name: string): EditableTextProperty | undefined {
        if (!this.state.textElements.has(name)) return undefined;

        // 同名的 TEXT 可能有多条（脚本里复制粘贴），以**最后一条**为生效定义 ——
        // 和对几何对象「同名以后者为准」的约定保持一致。
        let lineNumber: number | undefined;
        for (const command of this.state.topLevelCommands) {
            if (command.command.toUpperCase() !== 'TEXT') continue;
            const commandName = command.params.get('name') || command.params.get('id') || `text_${command.lineNumber}`;
            if (commandName === name) lineNumber = command.lineNumber;
        }

        if (lineNumber === undefined) {
            return {
                name,
                lineNumber: 0,
                editable: false,
                reason: '这段文字来自 CODE 块或动画帧，没有稳定的顶层源码行，请直接在脚本里修改。',
            };
        }

        return {
            name,
            lineNumber,
            editable: true,
            reason: '修改内容与样式后会写回脚本里这条 TEXT 指令所在的行。',
        };
    }

    public getEditableElementPosition(name: string): { type: string; x: number; y: number; frozen: boolean } | null {
        const object = this.state.objects.get(name);
        if (object && typeof (object as any).x === 'number' && typeof (object as any).y === 'number') {
            return {
                type: object.type,
                x: this.getPreviewProperty(name, 'x') ?? (object as any).x,
                y: this.getPreviewProperty(name, 'y') ?? (object as any).y,
                frozen: this.isObjectFrozen(name),
            };
        }
        const text = this.state.textElements.get(name);
        if (text) {
            return {
                type: 'text',
                x: this.getPreviewProperty(name, 'x') ?? text.x,
                y: this.getPreviewProperty(name, 'y') ?? text.y,
                frozen: false,
            };
        }
        return null;
    }

    /**
     * 该对象是否被冻结、禁止在画布上拖动。
     * 目前只有 POINT 支持 `frozen=true`；其它类型和解释器自动生成的点都是 false。
     */
    public isObjectFrozen(name: string): boolean {
        const object = this.state.objects.get(name);
        return object?.type === 'point' && (object as Point).frozen === true;
    }

    public previewObjectPropertyChange(name: string, key: ObjectPropertyKey, value: number): boolean {
        if (!Number.isFinite(value)) return false;
        const editable = this.getEditableObjectProperties(name).find(property => property.key === key);
        if (!editable?.editable) return false;
        let properties = this.state.previewObjectProperties.get(name);
        if (!properties) {
            properties = new Map();
            this.state.previewObjectProperties.set(name, properties);
        }
        properties.set(key, value);
        return true;
    }

    public clearPreviewObjectProperties(name?: string): void {
        if (name) this.state.previewObjectProperties.delete(name);
        else this.state.previewObjectProperties.clear();
    }

    private getPreviewProperty(name: string, key: ObjectPropertyKey): number | undefined {
        return this.state.previewObjectProperties.get(name)?.get(key);
    }

    private isLiteralNumber(value: string): boolean {
        return /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(value.trim());
    }

    public setRandomObjectFrozen(name: string, frozen: boolean): void {
        const object = this.state.objects.get(name);
        const source = this.state.randomObjectSources.get(name);
        if (!object || !source || object.type !== 'point') return;

        const point = object as Point;
        if (frozen) {
            this.state.frozenRandomObjects.set(name, { x: point.x, y: point.y });
        } else {
            this.state.frozenRandomObjects.delete(name);
        }
    }

    public getFrozenRandomObjects(): Record<string, { x: number; y: number }> {
        return Object.fromEntries(this.state.frozenRandomObjects.entries());
    }

    private formatObjectNumber(value: number): string {
        return Number(value.toFixed(6)).toString();
    }

    private getObjectDetails(object: GeometricObject): Record<string, string> {
        const details: Record<string, string> = { type: object.type };
        const candidate = object as any;
        const format = (value: number): string => this.formatObjectNumber(value);
        const pointDetails = (prefix: string, point: { x: number; y: number } | undefined) => {
            if (point) {
                details[`${prefix}.x`] = format(point.x);
                details[`${prefix}.y`] = format(point.y);
            }
        };

        if (typeof candidate.x === 'number' && typeof candidate.y === 'number') {
            pointDetails('position', candidate);
            if (typeof candidate.radius === 'number') details.radius = format(candidate.radius);
            if (typeof candidate.real === 'boolean') details.real = String(candidate.real);
            // 只有 POINT 有这个字段，所以其它对象不会多出一行噪声。
            if (typeof candidate.frozen === 'boolean') details.frozen = String(candidate.frozen);
        }
        if (candidate.center) pointDetails('center', candidate.center);
        if (typeof candidate.radius === 'number') details.radius = format(candidate.radius);
        if (typeof candidate.rx === 'number') details.radiusX = format(candidate.rx);
        if (typeof candidate.ry === 'number') details.radiusY = format(candidate.ry);
        if (typeof candidate.rotation === 'number') details.rotation = format(candidate.rotation);
        if (candidate.p1) pointDetails('p1', candidate.p1);
        if (candidate.p2) pointDetails('p2', candidate.p2);
        if (candidate.vertex) pointDetails('vertex', candidate.vertex);
        if (candidate.vertices && Array.isArray(candidate.vertices)) {
            details.vertices = String(candidate.vertices.length);
        }
        if (typeof candidate.width === 'number') details.width = format(candidate.width);
        if (typeof candidate.height === 'number') details.height = format(candidate.height);
        return details;
    }

    public setRandomVariableFrozen(name: string, frozen: boolean): void {
        const variable = this.state.variableInfo.get(name);
        if (!variable || variable.kind !== 'random') return;

        if (frozen) {
            this.state.frozenRandomValues.set(name, Number(variable.value));
        } else {
            this.state.frozenRandomValues.delete(name);
        }
        variable.frozen = frozen;
    }

    public getFrozenRandomVariables(): Record<string, number> {
        return Object.fromEntries(this.state.frozenRandomValues.entries());
    }

    public setRenderTarget(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D): void {
        this.state.canvas = canvas;
        this.state.ctx = context;
        this.state.defaultOptions.width = canvas.width;
        this.state.defaultOptions.height = canvas.height;
    }

    public getAnimationDefinitions(): Array<{
        name: string;
        code: string;
        slot: string;
        interval: number;
        isRepeat: boolean;
        period?: number;
    }> {
        return Array.from(this.state.animations.values()).map(animation => ({
            name: animation.name,
            code: animation.code,
            slot: animation.slot,
            interval: animation.interval,
            isRepeat: animation.isRepeat,
            period: animation.period,
        }));
    }

    public stepAnimation(name: string): void {
        const animation = this.state.animations.get(name);
        if (!animation) {
            throw new Error(`Animation ${name} not found`);
        }
        this.runAnimationCode(animation);
    }

    private isMetaCommand(cmd: string, includeCreate: boolean = false): boolean {
        // 清单只有一份，见 dslCommandNames.ts（以前这里和 HelpCommand 各存一份，漂移过）。
        // `WITHRUN`（WITH 的历史别名）和 `MESSAGE`（PRINT 的别名）也在里面 ——
        // 它们和主名字共用同一段实现，漏掉就会被当成几何指令报 "Unknown geometric command"。
        const upper = cmd.toUpperCase();
        // `CREATE` 只在允许它出现的位置才算元指令：`CREATE <几何指令>` 走的是几何分支。
        if (upper === 'CREATE') return includeCreate;
        return isMetaCommandName(upper);
    }

    // 解析单行指令
    private parseLine(line: string, lineNumber: number): ParsedCommand | null {
        try {
            // 移除多余的空格
            line = line.trim();
            if (!line) return null;

            // 去掉注释，但不能把颜色值中的 # 当成注释：
            // `color=#eeeeee` 中的 # 位于参数值内，只有行首或空白后的 # 才是注释起点。
            const commentMatch = /(^|\s)#/.exec(line);
            if (commentMatch) {
                const commentIndex = commentMatch.index + commentMatch[1].length;
                line = line.substring(0, commentIndex).trim();
                if (!line) return null;
            }

            // 分离指令和参数
            const parts = line.split(/\s+/);
            if (parts.length === 0) return null;

            const firstPart = parts[0].toUpperCase();

            // 判断是否为元指令，所有的几何指令都是跟随在CREATE这个元指令之后，所以以下数组需要排除CREATE

            const metaCommand = this.isMetaCommand(firstPart);

            let command: string;
            let paramString: string;

            if (metaCommand) {
                command = firstPart;
                paramString = parts.slice(1).join(' ');
            } else {
                // 几何指令，需要从元指令上下文中提取
                const secondPart = parts[1].toUpperCase();
                if (!secondPart) {
                    return null;
                }
                // 指令名只可能是 [A-Z_]，绝不会含 `=`。所以第二段带 `=` 就说明这一行
                // 不是 `<CREATE> <几何指令> ...` 的形状，直接取 parts[1] 会把**参数**当成
                // 指令名（`FOOBAR x=1` 报 "Unknown geometric command: X=1"，完全看不出问题在哪）。
                // 这里改成报第一个词，并区分两种常见写法错误。
                if (secondPart.includes('=')) {
                    throw new Error(isGeometricCommandName(firstPart)
                        // 例如 `POINT name=A x=0 y=0` 漏了 CREATE
                        ? `几何指令 ${firstPart} 必须写在 CREATE 之后, 例如 "CREATE ${firstPart} ..."`
                        : `未知指令: ${firstPart}（几何指令需写在 CREATE 之后）`);
                }
                command = secondPart;
                paramString = parts.slice(2).join(' ');
            }

            // 解析参数
            const params = this.parseParameters(paramString);

            return {
                type: metaCommand ? 'meta' : 'geometric',
                command,
                params,
                rawCommand: line,
                lineNumber
            };
        } catch (error) {
            console.error(`Failed to parse line: ${line}, at line ${lineNumber}: `, error);
            this.state.onMessage?.('error', lineNumber, `Failed to parse line: ${line}, at line ${lineNumber}: ${error}`);
            return null;
        }
    }

    // 解析参数字符串为键值对。
//
// 这里用手写扫描而不是正则：值里面允许出现 `=`，例如 LaTeX
// `text="$y=ax^2+bx+c$"`。原来的正则 `(\w+)=([^=\s]+...)` 会把值里的
// `y=` 当成下一个参数的键，导致真正的 `y=3` 被覆盖成 `ax^2+bx+c$"`，
// 于是 TEXT 就会报 "requires x and y parameters"。
private parseParameters(paramString: string): Map<string, string> {
    const params = new Map<string, string>();
    let i = 0;
    const n = paramString.length;

    while (i < n) {
        // 跳过空白
        while (i < n && /\s/.test(paramString[i])) i++;
        if (i >= n) break;

        // 读 key：\w+
        const keyStart = i;
        while (i < n && /\w/.test(paramString[i])) i++;
        const key = paramString.slice(keyStart, i);

        // key 后必须紧跟 `=`，否则整段跳过（并保证至少前进一格）
        if (key.length === 0 || i >= n || paramString[i] !== '=') {
            if (i < n && paramString[i] === '=') {
                i++;
            } else {
                while (i < n && !/\s/.test(paramString[i]) && paramString[i] !== '=') i++;
            }
            continue;
        }
        i++; // 吃掉 '='

        const quoteChar = paramString[i];
        if (quoteChar === '"' || quoteChar === "'") {
            // 引号包围的值：读到配对的闭合引号为止，
            // 内部的空格和 `=` 都属于值本身。
            i++;
            const valueStart = i;
            while (i < n && paramString[i] !== quoteChar) {
                if (paramString[i] === '\\' && i + 1 < n) i++; // 跳过被转义的字符
                i++;
            }
            params.set(key, paramString.slice(valueStart, i));
            if (i < n) i++; // 吃掉闭合引号
            continue;
        }

        // 无引号的值：值本身可以含 `=`，结束位置是
        // "空白 + 下一个 key=" 的地方，否则一直到字符串末尾。
        const afterEq = i;
        const hadLeadingSpace = i < n && /\s/.test(paramString[i]);
        while (i < n && /\s/.test(paramString[i])) i++;

        // `key= another=1` 这种空值情况：回退，让下一轮把后面识别成真正的参数。
        // 只有 `=` 后确实紧跟空白时才成立，否则 `label=a=b` 会被误判。
        if (hadLeadingSpace) {
            let probe = i;
            while (probe < n && /\w/.test(paramString[probe])) probe++;
            if (probe > i && probe < n && paramString[probe] === '=') {
                i = afterEq;
                continue;
            }
        }

        const valueStart = i;
        let end = n;
        for (let j = i; j < n; j++) {
            if (!/\s/.test(paramString[j])) continue;
            let k = j;
            while (k < n && /\s/.test(paramString[k])) k++;
            let m = k;
            while (m < n && /\w/.test(paramString[m])) m++;
            if (m > k && m < n && paramString[m] === '=') {
                end = j;
                break;
            }
        }
        params.set(key, paramString.slice(valueStart, end).trim());
        i = end;
    }

    return params;
}

    // 执行解析后的指令
    private executeCommand(command: ParsedCommand): void {
        this.state.currentCommandLine = command.lineNumber;
        if (command.type === 'meta') {
            this.executeMetaCommand(command.command.toUpperCase(), command.params, command.rawCommand, command.lineNumber);
        } else {
            this.executeGeometricCommand(command.command.toUpperCase(), command.params);
        }
    }

    // 执行元指令
    private executeMetaCommand(command: string, params: Map<string, string>, rawCommand: string, lineNumber: number): void {
        switch (command.toUpperCase()) {
            case 'SET':
                this.executeSetOptions(params);
                break;
            case 'HELP':
                this.executeHelp(params, lineNumber);
                break;
            case 'CLEAR':
                this.executeClear(params);
                break;
            case 'VIEW':
                this.executeView(params);
                break;
            case 'DRAW':
                this.executeDraw(params);
                break;
            case 'TEXT':
                this.executeText(params, rawCommand, lineNumber);
                break;
            case 'FILL':
                this.executeFill(params);
                break;
            case 'MEASURE':
                this.executeMeasure(params);
                break;
            case 'RUN':
                this.executeRunCommands(params);
                break;
            case 'CODE':
                this.createCodeBlock(params);
                break;
            case 'WITH':
            case 'WITHRUN':
                this.executeWithRun(params);
                break;
            case 'GETOBJ':
                this.executeGetObject(params);
                break;
            case 'SETLABEL':
                this.executeSetLabel(params, rawCommand);
                break;
            case 'CALCULATE':
                this.executeCalculate(params);
                break;
            case 'PRINT':
            case 'MESSAGE':
                this.executePrint(params, rawCommand, lineNumber);
                break;
            default:
                throw new Error(`Unknown meta command: ${command}`);
        }
    }

    // 执行几何指令
    private executeGeometricCommand(command: string, params: Map<string, string>): void {
        switch (command.toUpperCase()) {
            case 'POINT':
                this.createPoint(params);
                break;
            case 'LINE':
                this.createLine(params);
                break;
            case 'SEGMENT':
                this.createSegment(params);
                break;
            case 'RAY':
                this.createRay(params);
                break;
            case 'MIDPOINT':
                this.createMidpoint(params);
                break;
            case 'PERPENDICULAR_FOOT':
                this.createPerpendicularFoot(params);
                break;
            case 'REFLECTED_POINT':
                this.createReflectedPoint(params);
                break;
            case 'ROTATED_POINT':
                this.createRotatedPoint(params);
                break;
            case 'INTERSECT':
                this.createIntersection(params);
                break;
            case 'POINT_ON_LINE':
                this.createPointOnLine(params);
                break;
            case 'POINT_ON_CIRCLE':
                this.createPointOnCircle(params);
                break;
            case 'CIRCLE_CENTER':
                this.createCircleCenter(params);
                break;
            case 'PERP_BISECTOR':
                this.createPerpBisector(params);
                break;
            case 'PERPENDICULAR':
                this.createPerpendicular(params);
                break;
            case 'PARALLEL':
                this.createParallel(params);
                break;
            case 'ANGLE_BISECTOR':
                this.createAngleBisector(params);
                break;
            case 'CIRCUMCIRCLE':
                this.createCircumcircle(params);
                break;
            case 'INCIRCLE':
                this.createIncircle(params);
                break;
            case 'TANGENT':
                this.createTangent(params);
                break;
            case 'POLYGON':
                this.createPolygon(params);
                break;
            case 'POINTSET':
                this.createPointSet(params);
                break;
            case 'AXIS':
                this.createAxis(params);
                break;
            case 'GRID':
                this.createGrid(params);
                break;
            case 'REGION':
                this.createRegion(params);
                break;
            case 'TRIANGLE':
                this.createTriangle(params);
                break;
            case 'RECTANGLE':
                this.createRectangle(params);
                break;
            case 'CIRCLE':
                this.createCircle(params);
                break;
            case 'ELLIPSE':
                this.createEllipse(params);
                break;
            case 'PARABOLA':
                this.createParabola(params);
                break;
            case 'HYPERBOLA':
                this.createHyperbola(params);
                break;
            case 'ANGLE':
                this.createAngle(params);
                break;
            case 'FOCIS':
                this.createFocis(params);
                break;
            case 'RANDOMPOINT':
                this.createRandomPoint(params);
                break;
            case 'SLOT':
                this.createSlot(params);
                break;
            case 'FUNCTION':
                this.createFunction(params);
                break;
            case 'ANIMATION':
                this.createAnimation(params);
                break;
            case 'CURVE':
                this.createCurve(params);
                break;
            default:
                throw new Error(`Unknown geometric command: ${command}`);
        }
    }

    // 元指令清空画板
    private executeClear(params: Map<string, string>): void {
        const color = this.parseColor(params, 'color') || this.parseColor(params, 'c') || this.state.defaultOptions.penColor;
        // `geoColor` 以前写成了 `getColor`（拼写错误），于是 HELP 和文档都推荐的
        // `CLEAR geoColor=red` 被静默忽略，只有别名 `g=` 生效。`getColor` 在仓库里
        // 没有任何使用处，所以直接改名，不保留这个错拼的别名。
        const geoColor = this.parseColor(params, 'geoColor') || this.parseColor(params, 'g') || this.state.defaultOptions.geoColor;
        const labelColor = this.parseColor(params, 'labelColor') || this.parseColor(params, 'l') || this.state.defaultOptions.labelColor;

        // 确认我们有 canvas 的 2D 渲染上下文 (context)
        if (this.state.ctx) {
            const ctx = this.state.ctx;
            const canvas = this.state.canvas!; // 使用非空断言操作符

            this.state.defaultOptions.geoColor = geoColor;
            this.state.defaultOptions.labelColor = labelColor;

            // 1. 保存当前 canvas 状态 (可选，但推荐)
            // 这可以防止本次颜色设置影响到后续的绘制操作
            ctx.save();

            // 2. 设置填充颜色
            // 将 fillStyle 设置为您想要用来清空画布的颜色
            ctx.fillStyle = color;

            // 3. 绘制一个覆盖整个 canvas 的矩形
            // fillRect(x, y, width, height)
            ctx.fillRect(this.state.defaultOptions.canvasX, this.state.defaultOptions.canvasY, this.state.defaultOptions.width, this.state.defaultOptions.height);

            // 4. 恢复之前保存的 canvas 状态 (可选，但推荐)
            ctx.restore();
        }

        // CLEAR 抹掉了整块画布，上一轮登记的标签/文字命中区域和绘制顺序也随之失效。
        // 动画每帧都是「CLEAR + 重画」，不在这里清理会让这三个列表随帧数无限增长，
        // 既拖慢命中检测，又会留下已经看不见的「幽灵」标签可被点选。
        this.state.labelHitRegions = [];
        this.state.textHitRegions = [];
        this.state.renderedObjectNames = [];
        // 收集到的待绘对象同理：CLEAR 把它们连同画布一起抹掉，
        // 否则「先建对象再 CLEAR」的脚本会在清屏之后把它们又画回来。
        this.state.pendingDraws = [];
        this.state.pendingCutResolutions.clear();
    }

    // 设置全局默认属性。
    //
    // 支持两种写法（可混用）：
    //   SET labelColor=white                     —— 推荐的简写，一行一个属性名；
    //   SET item=labelColor value=white          —— 老写法，一次只设一个（向后兼容）；
    //   SET labelColor=white pointRadius=6       —— 一行设多个不同属性（简写形式可叠加）。
    //
    // 之所以要「简写 + 多属性」，是因为老写法每设一个属性就要敲一遍 `item=` 和
    // `value=`，想同时改几个全局项就得写好几行 `SET`，可读性很差。
    //
    // 注意：这是唯一一条既收「属性名」又收 `item`/`value` 关键字的指令。
    // `item` / `value` 只是关键字，不会和简写的属性名撞车 —— 遍历时会跳过这两个键。
    //
    // 混用时的优先级：**老写法先应用，且每个属性只应用一次**。这样
    // `SET item=labelColor value=blue labelColor=red` 与
    // `SET labelColor=red item=labelColor value=blue` 结果相同（都是 blue），
    // 不会因为书写顺序不同而得到不同颜色。
    private executeSetOptions(params: Map<string, string>): void {
        const legacyItem = params.get('item');
        const legacyValue = params.get('value');

        // 老写法（item= + value=）优先当成一对处理，行为与过去完全一致。
        // 只有当 `item=` 没写、但 `value=` 写了时才认为用户写漏了 name。
        if (legacyItem !== undefined) {
            if (legacyValue === undefined) {
                throw new Error('SET command requires "item" and "value" parameters.');
            }

            this.applySettingItem(legacyItem, legacyValue, params);
        }

        // 简写：剩下的 `属性名=值` 全部按属性处理。
        // 一行可以写多个，各自独立生效（一个失败不影响其它）。
        const applied = new Set<string>();
        if (legacyItem !== undefined) applied.add(legacyItem.toLowerCase());

        for (const [key, rawValue] of params) {
            const lower = key.toLowerCase();
            if (lower === 'item' || lower === 'value') continue;
            if (!rawValue.trim()) continue; // `SET foo=` 这种空值直接忽略
            // 同一个属性只应用一次，且老写法优先 —— 否则
            // `SET labelColor=red item=labelColor value=blue` 会被简写分支再赋值回 red，
            // 与「按出现顺序，后者生效」的直觉相反。
            if (applied.has(lower)) continue;
            applied.add(lower);
            this.applySettingItem(key, rawValue, params);
        }

        if (legacyItem === undefined && !this.hasShorthandSetting(params)) {
            throw new Error('SET command requires at least one "属性名=值" pair (或 "item=" 与 "value=").');
        }
    }

    // 解析一个「必须是数字」的设置值，支持 `{slot}` 表达式。
    // 非法值抛错（例如 `SET pointRadius=abc`），而不是让 `parseFloat` 给出 NaN
    // 悄悄写进 defaultOptions —— 那样后面的绘制会莫名其妙地什么都不显示。
    private parseSettingNumber(item: string, value: string, params: Map<string, string>): number {
        const parsed = this.getNumberValue(params, 'value');
        if (parsed === undefined || !Number.isFinite(parsed)) {
            throw new Error(`set option ${item} fail, your value ${value} is invalid`);
        }
        return parsed;
    }

    // 判断参数里是否至少有一个简写形式的 `属性名=值`（排除 item/value 关键字）。
    private hasShorthandSetting(params: Map<string, string>): boolean {
        for (const [key, rawValue] of params) {
            const lower = key.toLowerCase();
            if (lower === 'item' || lower === 'value') continue;
            if (rawValue.trim()) return true;
        }
        return false;
    }

    // 应用单个设置项。key 大小写不敏感，别名与原名字等价。
    //
    // `params` 是原样透传的「本次 SET 的全部参数」，只为了让 `parseColor` /
    // `getNumberValue` 这类辅助方法能按 key 去取原始值（它们要拿原文来识别
    // `{slot}` 表达式，光有已解析出的字符串不够）。
    private applySettingItem(
        item: string,
        value: string,
        params: Map<string, string>
    ): void {
        let isUnKnownCmd = false;

        // 把「属性名 -> 原始值」统一成一张表，这样下面可以直接用属性名查，
        // 不必关心用户写的是 `labelColor=white` 还是 `item=labelColor value=white`。
        //
        // 这一点很关键：`parseColor(params, 'labelColor')` 在**老写法**下会取不到值 ——
        // 老写法的 map 里只有 `item`/`value` 两个键，属性名根本不在其中，
        // 于是颜色类设置会被静默忽略（`if (this.parseColor(...))` 为假就什么都不做）。
        const scopedParams = new Map<string, string>(params);
        scopedParams.set(item.toLowerCase(), value);
        // 老写法下属性名不在 map 里，辅助方法按属性名取不到时还能退回 `value` 键。
        scopedParams.set('item', item);
        scopedParams.set('value', value);

        try {
            switch (item.toLowerCase()) {
                case 'backgroundcolor':
                    this.state.defaultOptions.backgroundColor = value;
                    break;
                case 'pencolor':
                    if (this.parseColor(scopedParams, 'pencolor')) {
                        this.state.defaultOptions.penColor = this.parseColor(scopedParams, 'pencolor')!;
                    }
                    break;
                case 'pensize':
                    this.state.defaultOptions.penSize = this.parseSettingNumber(item, value, scopedParams);
                    break;
                case 'labelfont':
                    this.state.defaultOptions.labelFont = value;
                    break;
                case 'labelcolor':
                    if (this.parseColor(scopedParams, 'labelcolor')) {
                        this.state.defaultOptions.labelColor = this.parseColor(scopedParams, 'labelcolor')!;
                    }
                    break;
                case 'labelsize':
                    this.state.defaultOptions.labelSize = this.parseSettingNumber(item, value, scopedParams);
                    break;
                case 'pointradius':
                    this.state.defaultOptions.pointRadius = this.parseSettingNumber(item, value, scopedParams);
                    break;
                case 'pointfill':
                    this.state.defaultOptions.pointFill = GeometryDSLInterpreter.parseBoolean(value);
                    break;
                case 'drawlabelforpoints':
                    this.state.defaultOptions.drawLabelForPoints = GeometryDSLInterpreter.parseBoolean(value);
                    break;
                case 'drawlabelforothers':
                    this.state.defaultOptions.drawLabelForOthers = GeometryDSLInterpreter.parseBoolean(value);
                    break;
                case 'linelength':
                case 'linelen':
                    this.state.defaultOptions.lineLength = this.parseLineLength(scopedParams, value);
                    break;
                case 'geocolor':
                // help 里一直写着 `geoColor/defaultGeoColor` 两个名字，但只实现了前者，
                // 于是 `SET item=defaultGeoColor ...` 会抛 Unknown setting item。补上别名。
                case 'defaultgeocolor':
                    if (this.parseColor(scopedParams, 'geocolor')) {
                        this.state.defaultOptions.geoColor = this.parseColor(scopedParams, 'geocolor')!;
                    } else {
                        this.state.defaultOptions.geoColor = value;
                    }
                    break;
                // 这两个以前写的是 canvasX / canvasY —— 那是**由画布外层变换推导出来的**
                // 可视矩形原点（见 setTransform / setRenderTransform），不是视图中心，
                // 而且每次重算都会被覆盖。文档写的是「视图中心X/Y坐标」，`SET scale` 也确实
                // 写的是 scale，所以这里应当和 VIEW centerX/centerY 落到同一个字段。
                case 'centerx':
                    this.state.defaultOptions.centerX = this.parseSettingNumber(item, value, scopedParams);
                    break;
                case 'centery':
                    this.state.defaultOptions.centerY = this.parseSettingNumber(item, value, scopedParams);
                    break;
                case 'scale':
                    this.state.defaultOptions.scale = this.parseSettingNumber(item, value, scopedParams);
                    break;
                // 视图旋转（度），与 `VIEW rotation=` 落到同一个字段。
                case 'rotation':
                case 'rotate':
                case 'angle':
                    this.state.defaultOptions.rotation = this.parseSettingNumber(item, value, scopedParams);
                    break;

                default:
                    isUnKnownCmd = true;
                    throw new Error(`Unknown setting item: ${item}`);
            }
        }
        catch (error: any) {
            if (isUnKnownCmd) {
                throw error;
            }

            throw new Error(`set option ${item} fail, your value ${value} is invalid`);
        }

        // 可选：向用户反馈设置成功
        this.state.onMessage?.('info', 0, `Set ${item} to ${value}`);
    }

    // 解析直线/射线的绘制长度：
    // - 正数（也可以是 {slot} 表达式）：固定长度，单位与几何坐标一致
    // - auto / screen / default / none，以及 0、负数、非法值：恢复默认（只延伸到可视区域边缘）
    private parseLineLength(params: Map<string, string>, value: string): number | null {
        const normalized = value.trim().toLowerCase();

        if (!normalized
            || normalized === 'auto'
            || normalized === 'screen'
            || normalized === 'default'
            || normalized === 'none') {
            return null;
        }

        // `params` 已经是 applySettingItem 里归一化过的表，`'value'` 键必然指向
        // 本次要设的原始文本（简写与老写法都成立），所以这里不用关心用户怎么写。
        // `getNumberValue` 需要原始文本是为了识别 `{slot}` 表达式。
        const parsed = this.getNumberValue(params, 'value');
        if (parsed === undefined || !Number.isFinite(parsed) || parsed <= 0) {
            return null;
        }

        return parsed;
    }

    // 帮助信息
    private executeHelp(params: Map<string, string>, line: number): void {
        let message: string = '';
        if (params.size == 0) {
            message = getHelpMessages('', '');
        }

        const cmd = params.get('cmd') || params.get('command') || params.get('c');
        if (cmd == null) {
            message = getHelpMessages('', '');
        } else {
            if (this.isMetaCommand(cmd, true)) {
                message = getHelpMessages(cmd, '');
            } else {
                message = getHelpMessages('', cmd);
            }
        }

        if (this.state.onMessage) {
            this.state.onMessage('info', line, message);
        }
    }

    private executeView(params: Map<string, string>): void {
        if (params.has('centerX')) {
            const centerX = this.getNumberValue(params, 'centerX')
            if (centerX === undefined) {
                throw new Error('VIEW command requires centerX parameter');
            }
            this.state.defaultOptions.centerX = centerX;
        }
        if (params.has('centerY')) {
            const centerY = this.getNumberValue(params, 'centerY')
            if (centerY === undefined) {
                throw new Error('VIEW command requires centerY parameter');
            }
            this.state.defaultOptions.centerY = centerY;
        }
        if (params.has('scale')) {
            const scale = this.getNumberValue(params, 'scale');
            if (scale === undefined || isNaN(scale) || Math.abs(scale) < this.zeroThresholdValue) {
                throw new Error('VIEW command requires scale parameter');
            }
            this.state.defaultOptions.scale = scale;
        }
        // 视图旋转：绕画布中心转，单位是**度**（正值 = 屏幕上顺时针），与 scale 同级。
        // `angle` 是等价别名，方便手写脚本时少查一次参数名。
        if (params.has('rotation') || params.has('rotate') || params.has('angle')) {
            const rotation = this.getNumberValue(params, 'rotation')
                ?? this.getNumberValue(params, 'rotate')
                ?? this.getNumberValue(params, 'angle');
            if (rotation === undefined || !Number.isFinite(rotation)) {
                throw new Error('VIEW command requires rotation parameter');
            }
            this.state.defaultOptions.rotation = rotation;
        }
    }

    private drawObject(ctx: CanvasRenderingContext2D, params: Map<string, string>, obj: GeometricObject, label: string | undefined): void {
        // 记录实际绘制顺序，命中检测时让视觉上层的对象优先。
        this.state.renderedObjectNames.push(obj.name);

        // 「绘制坐标 -> 最终屏幕像素」的倍率，只用来折算默认线宽/点半径。
        // Canvas：坐标还要经过外层 ctx.setTransform，所以倍率是那个矩阵的缩放；
        // SVG：viewBox 与画布同尺寸，1 用户单位就是 1 像素，倍率恒为 1。
        // 注意不能用下面的 transform.scale —— 它含 VIEW scale，而 VIEW scale 已经烘进坐标里了。
        const pixelScale = this.state.contextPreTransformed ? this.state.outerScale : 1;

        // 解析绘制选项
        const options: DrawOptions = {};
        if (params.has('color')) {
            options.color = this.parseColor(params, 'color') || this.parseColor(params, 'c') || this.state.defaultOptions.geoColor;
        } else {
            // 没写 `color=` 就用 `CLEAR geoColor=` / `SET item=geoColor` 设的默认几何色。
            // 几何类里取色的写法是 `options?.color || 'black'`，而默认 geoColor 恰好也是 'black'，
            // 所以**不设 geoColor 时与「根本不传 color」渲染完全相同**（逐字节可验）。
            // 以前这里只在写了 `color=` 时才赋值，于是 HELP 承诺的
            // 「geoColor: 后续几何图形的默认颜色」其实从没生效过。
            options.color = this.state.defaultOptions.geoColor;
        }
        if (params.has('width')) {
            options.lineWidth = this.getNumberValue(params, 'width') || this.getNumberValue(params, 'w') || 1; // 默认线宽为1
        } else {
            // 没写 width= 就用 `SET item=penSize` 的默认线宽。
            // penSize 与默认线宽同口径（**屏幕像素**），而 options.lineWidth 是逻辑单位、
            // 会被外层变换按 pixelScale 放大，所以这里先折回逻辑单位，画出来才是恒定的 penSize 像素。
            // 默认 penSize=1 与 DEFAULT_LINE_WIDTH_PIXELS 相同 → 不设 SET 时行为完全不变。
            options.lineWidth = this.state.defaultOptions.penSize / Math.max(Math.abs(pixelScale), 1e-6);
        }
        if (params.has('fill')) options.fillColor = this.parseColor(params, 'fill') || this.parseColor(params, 'f') || this.state.defaultOptions.backgroundColor;
        // 没写 radius= 的点用它当默认半径（屏幕像素）。命中检测必须用同一个值，
        // 否则「点画多大」和「点多容易被点中」会对不上（见 hitTestSelection）。
        options.defaultPointRadiusPixels = this.state.defaultOptions.pointRadius;
        // 虚线样式有三种写法，都要认：
        //   style=dashed / s=dashed  —— HELP 里主推的写法；
        //   dashed=true / dash=true  —— AXIS/GRID 用的是这个布尔形式，用户很自然会照搬到这里，
        //                               以前这里只认 style，于是 `CREATE CIRCUMCIRCLE ... dashed=true`
        //                               被静默忽略、圆画成实线。
        // dashed=false 显式关掉，覆盖可能同时出现的 style=dashed。
        if (params.has('style') && params.get('style') === 'dashed') options.dashed = true;
        if (params.has('s') && params.get('s') === 'dashed') options.dashed = true;
        if (params.has('dashed') || params.has('dash')) {
            options.dashed = this.getBooleanParam(params, false, 'dashed', 'dash');
        }
        const isObjectSelected = this.state.selectedObjectNames.has(obj.name)
            || this.state.selectedObjectName === obj.name;
        if (isObjectSelected) {
            options.highlight = true;
            options.color = SELECTED_OBJECT_COLOR;
            // 点和显式填充区域需要同时改变填充色；普通线框对象不额外填充。
            if (obj instanceof Point || params.has('fill')) {
                options.fillColor = SELECTED_OBJECT_COLOR;
            }
        }

        // 直线/射线的绘制长度：未指定时只画到可视区域边缘
        if (this.state.defaultOptions.lineLength != null) {
            options.length = this.state.defaultOptions.lineLength;
        }
        // 可视区域（画布坐标），供直线/射线裁剪使用。
        // 有视图旋转时这里返回旋转后矩形的包围盒（略大），只影响线往画布外多画一点。
        options.visibleRect = this.getVisibleViewRect();

        // 计算变换参数。Canvas 的外层缩放/平移由 ctx.setTransform 提供；
        // SVG 导出没有这个外层矩阵，因此由 renderScale/renderOffset 直接合并进来。
        const transform = this.getTextRenderTransform(pixelScale);

        obj.draw(ctx, transform, options);

        // 处理标签。**总开关放在这里**，不要在 collectDraw 里再判一次 ——
        // 两处各写一份条件迟早会走偏。点看 `drawLabelForPoints`，其它对象看 `drawLabelForOthers`。
        //
        // 标签有两个显式来源：创建行上的 `label=`，以及 `DRAW obj=X label=Y` 上的。
        // 空串当作「没有标签」，这样面板里把标签清空就是真的不显示。
        // **不再回落到对象名** —— 名字是给引用用的标识符，不是给用户看的文字。
        const autoLabel = obj instanceof Point
            ? this.state.defaultOptions.drawLabelForPoints
            : this.state.defaultOptions.drawLabelForOthers;
        // `SETLABEL` 设过的对象以覆盖表为准，优先级高于脚本里的 `label=`。
        // 用 `has()` 而不是判空串：覆盖值可能是**空串**，那表示「显式要求不显示标签」，
        // 与「没设过、请回落到脚本」是两回事。
        const override = this.state.labelOverrides.get(obj.name);
        const explicitLabel = override !== undefined
            ? override
            : (label ?? params.get('label') ?? params.get('l'));
        // 总开关只约束「脚本里顺手写的 label=」。用户用 SETLABEL 明确点名要标签时，
        // 再拿 `drawLabelForOthers=false`（其余对象的默认值）把他挡住就没道理了 ——
        // 那会表现为「指令执行成功、但图上什么都没出现」。
        const labelAllowed = override !== undefined ? true : autoLabel;
        if (labelAllowed && explicitLabel != null && explicitLabel !== '') {
            // 标签与几何对象一样，都需要完整的逻辑坐标到画布坐标换算。
            // Canvas 的 ctx 只预置了拖拽平移/缩放，不包含 centerX/centerY 的视图偏移；
            // SVG 上下文也没有预置变换，因此两种渲染路径都传入完整 transform。
            const labelId = `label:${obj.name}:${this.state.labelHitRegions.length}`;
            this.drawLabel(obj, explicitLabel, params, transform, labelId);
        }
    }

    private executeDraw(params: Map<string, string>): void {
        const objName = params.get('obj');
        if (!objName) {
            throw new Error('DRAW command requires obj parameter');
        }

        const names = objName.split(',')

        for (let name of names) {
            name = name.trim();
            const obj = this.getObject(name);
            if (!obj) {
                throw new Error(`Object ${name} not found`);
            }

            if (!this.state.ctx) {
                throw new Error('No canvas context available for drawing');
            }

            // `DRAW obj=X` 一般就是「显式、带样式、画在这个位置」，按原样立即绘制。
            // 但有两种情况不能在这里画：
            //   1) 它已经在待绘队列里（create 上写了 draw=true）—— 再画一次的话，
            //      最后统一绘制的那一次会盖在上面，`DRAW` 指定的样式反而失效。
            //      所以只把这次的样式并到队列项上，位置仍是创建顺序里的位置。
            //   2) 它的截止点还没解析出来（引用的点还没建）—— 「还没准备好」，
            //      现在画就是整条，而画布只增不减、之后盖不掉。并入待绘队列等冲刷。
            const queued = this.state.pendingDraws.some(entry => entry.object === obj);
            if (queued || this.state.pendingCutResolutions.has(name)) {
                this.mergePendingDraw(params, obj, undefined);
                continue;
            }

            this.drawObject(this.state.ctx, params, obj, undefined);
        }
    }

    // 为一个已创建的封闭对象填充颜色。
    // FILL 的 color 表示填充色；borderColor 可选，用于控制边界线颜色。
    private executeFill(params: Map<string, string>): void {
        const objName = params.get('obj') || params.get('region') || params.get('o');
        if (!objName) {
            throw new Error('FILL command requires obj or region parameter');
        }

        const fillColor = this.parseColor(params, 'color')
            || this.parseColor(params, 'fill')
            || this.parseColor(params, 'f');
        if (!fillColor) {
            throw new Error('FILL command requires color (or fill) parameter');
        }

        if (!this.state.ctx) {
            throw new Error('No canvas context available for drawing');
        }

        const borderColor = this.parseColor(params, 'borderColor') || this.state.defaultOptions.geoColor;
        const drawParams = new Map(params);
        drawParams.set('obj', objName);
        drawParams.set('fill', fillColor);
        drawParams.set('color', borderColor);

        for (const rawName of objName.split(',')) {
            const name = rawName.trim();
            const obj = this.getObject(name);
            if (!obj) {
                throw new Error(`Object ${name} not found`);
            }
            if (!(obj instanceof Polygon || obj instanceof CircularRegion || obj instanceof CurveCircleRegion || obj instanceof Circle || obj instanceof Ellipse)) {
                throw new Error(`FILL only supports closed objects: region, circular-region, curve-circle-region, polygon, triangle, rectangle, circle, or ellipse. Object ${name} is ${obj.type}`);
            }

            // 对象写了 draw=true、还排在待绘队列里没画。这里立即画的话，末尾统一绘制
            // 那一次会用 create 时的样式（没有 fill、color 也回落到默认黑）盖上去，
            // `FILL` 的填充和 borderColor 就被吃掉了。并进队列项，等统一绘制一次画对。
            if (this.state.pendingDraws.some(entry => entry.object === obj)) {
                this.mergePendingDraw(drawParams, obj, undefined);
                continue;
            }

            this.drawObject(this.state.ctx, drawParams, obj, undefined);
        }
    }

    private executeMeasure(params: Map<string, string>): void {
        const type = params.get('type') || params.get('t') || 'length';
        let value = 0;
        switch (type.toLowerCase()) {
            case 'distance':
            case 'length':
            case 'd':
                value = this.measureDistance(params);
                break;
            case 'angle':
                value = this.measureAngle(params);
                break;
            case 'area':
                value = this.measureArea(params);
                break;
        }

        const slot = params.get('slot') || params.get('s');
        if (slot) {
            this.state.slots.set(slot, value);
            console.log(`Measured value for ${type} stored in slot ${slot}: ${value}`);
        }
    }

    private measureDistance(params: Map<string, string>): number {
        const objName = params.get('obj') || params.get('o');

        if (!objName) {
            const p1Name = params.get('p1') || params.get('point1');
            const p2Name = params.get('p2') || params.get('point2');

            if (!p1Name || !p2Name) {
                throw new Error('Distance measurement requires p1 and p2 parameters for Point objects');
            }

            const p1 = this.getObject(p1Name);
            const p2 = this.getObject(p2Name);

            if (!p1 || !p2) {
                throw new Error(`Points ${p1Name} or ${p2Name} not found`);
            }

            if (!(p1 instanceof Point) || !(p2 instanceof Point)) {
                throw new Error(`Distance measurement is only supported for Point objects`);
            }

            // 计算两个点的距离
            return p1.distanceTo(p2);

        } else {
            const obj = this.getObject(objName);
            if (!obj) {
                throw new Error(`Object ${objName} not found`);
            }

            if (!(obj instanceof Segment)) {
                throw new Error(`Distance measurement is only supported for Point objects`);
            }

            // 如果是线段对象，直接返回线段长度
            return obj.length;
        }
    }

    private measureAngle(params: Map<string, string>): number {
        const objName = params.get('obj') || params.get('o');
        if (objName) {
            // --- 模式一: 直接测量一个Angle对象 ---
            const obj = this.getObject(objName);
            if (!obj) {
                throw new Error(`Object ${objName} not found`);
            }
            if (!(obj instanceof Angle)) {
                throw new Error(`Angle measurement via 'obj' parameter is only supported for Angle objects`);
            }

            // 如果是角度对象，直接返回角度值（从弧度转换为度）
            return (obj.value * 180) / Math.PI;
        }

        // --- 模式二: 由一个顶点和两个其他点形成角 ---
        const vertexName = params.get('vertex') || params.get('v');
        if (vertexName) {
            const p1Name = params.get('p1');
            const p2Name = params.get('p2');

            if (p1Name == null || p2Name == null) {
                throw new Error('Angle measurement by vertex requires p1 and p2 parameters.');
            }

            const vertex = this.getObject(vertexName);
            const p1 = this.getObject(p1Name);
            const p2 = this.getObject(p2Name);

            if (!vertex || !(vertex instanceof Point) || !p1 || !(p1 instanceof Point) || !p2 || !(p2 instanceof Point)) {
                throw new Error(`Invalid points provided for angle measurement. Check if ${vertexName}, ${p1Name}, ${p2Name} are valid points.`);
            }

            // 计算从顶点到p1和p2的两个向量
            const v1x = p1.x - vertex.x;
            const v1y = p1.y - vertex.y;
            const v2x = p2.x - vertex.x;
            const v2y = p2.y - vertex.y;

            // 计算点积
            const dotProduct = v1x * v2x + v1y * v2y;
            // 计算两个向量的模（长度）
            const mag1 = Math.sqrt(v1x * v1x + v1y * v1y);
            const mag2 = Math.sqrt(v2x * v2x + v2y * v2y);

            // 如果任意一个向量长度为0，则角度为0
            if (mag1 === 0 || mag2 === 0) {
                return 0;
            }

            // 计算夹角的余弦值: cos(θ) = (v1 · v2) / (|v1| * |v2|)
            let cosTheta = dotProduct / (mag1 * mag2);

            // 处理浮点数精度误差，确保cosTheta在[-1, 1]范围内
            cosTheta = Math.max(-1, Math.min(1, cosTheta));

            // 计算弧度并转换为度数后返回
            const angleRad = Math.acos(cosTheta);
            return angleRad * (180 / Math.PI);
        }

        // --- 模式三: 由两条直线形成夹角 ---
        const line1Name = params.get('obj1') || params.get('line1') || params.get('l1');
        const line2Name = params.get('obj2') || params.get('line2') || params.get('l2'); // 修正了这里的笔误
        if (line1Name && line2Name) {
            const line1 = this.getObject(line1Name);
            const line2 = this.getObject(line2Name);

            if (!line1 || !(line1 instanceof LinearObject) || !line2 || !(line2 instanceof LinearObject)) {
                throw new Error(`Invalid lines provided for angle measurement. Check if ${line1Name} and ${line2Name} are valid lines.`);
            }

            // 获取两条线的方向向量
            const v1x = line1.p2.x - line1.p1.x;
            const v1y = line1.p2.y - line1.p1.y;
            const v2x = line2.p2.x - line2.p1.x;
            const v2y = line2.p2.y - line2.p1.y;

            // 计算点积
            const dotProduct = v1x * v2x + v1y * v2y;
            // 计算两个向量的模（长度）
            const mag1 = Math.sqrt(v1x * v1x + v1y * v1y);
            const mag2 = Math.sqrt(v2x * v2x + v2y * v2y);

            if (mag1 === 0 || mag2 === 0) {
                return 0; // 如果其中一条线是无效的（长度为0），则夹角为0
            }

            // 计算夹角余弦值。取点积的绝对值以确保我们得到的是锐角（或直角）。
            const cosTheta = Math.abs(dotProduct) / (mag1 * mag2);

            // 处理浮点数精度误差
            const clampedCosTheta = Math.max(-1, Math.min(1, cosTheta));

            const angleRad = Math.acos(clampedCosTheta);
            return angleRad * (180 / Math.PI);
        }

        // 如果以上模式都不匹配，则抛出错误
        throw new Error('To measure an angle, provide an Angle object, or a vertex with two points, or two lines.');
    }

    private measureArea(params: Map<string, string>): number {
        const objName = params.get('obj');
        if (!objName) {
            throw new Error('MEASURE AREA command requires obj parameter');
        }
        const obj = this.getObject(objName);
        if (obj instanceof Polygon) {
            // 如果是多边形对象，返回面积
            return obj.area;
        }

        if (obj instanceof Circle) {
            // 如果是圆对象，返回面积
            return Math.PI * obj.radius * obj.radius;
        }

        if (obj instanceof Ellipse) {
            // 如果是椭圆对象，返回面积
            return Math.PI * obj.rx * obj.ry;
        }

        throw new Error(`Area measurement is only supported for Polygon and Circle objects`);
    }

    // 执行一段指令
    private executeRunCommands(params: Map<string, string>): void {
        const codeName = params.get('code');
        if (!codeName) {
            throw new Error('RUN command requires code parameter');
        }

        const commands = this.state.codes.get(codeName);
        if (!commands) {
            throw new Error(`Code ${codeName} not found`);
        }

        // 执行代码片段
        this.executeLines(toLogicalLines(commands), false);
    }

    // 创建代码块
    private createCodeBlock(params: Map<string, string>): void {
        const blockName = params.get('name');
        if (!blockName) {
            throw new Error('BLOCK command requires name parameter');
        }

        // 如果已经存在同名代码块，则覆盖
        this.state.lastCodeName = blockName;
        this.state.codes.set(blockName, []);
        console.log(`Created code block: ${blockName}`);
    }

    // 执行WITHRUN指令
    private executeWithRun(params: Map<string, string>): void {
        const codeName = params.get('code') || params.get('c');
        const withSlot = params.get('with') || params.get('w');
        if (!codeName || !withSlot) {
            throw new Error('WITH command requires code parameter');
        }

        const commands = this.state.codes.get(codeName);
        if (!commands) {
            throw new Error(`Code ${codeName} not found`);
        }

        const withValue = this.getNumberValue(params, 'with') || this.getNumberValue(params, 'w');
        if (withValue === undefined || isNaN(withValue) || Math.abs(withValue) < this.zeroThresholdValue) {
            return;
        }

        // 执行代码片段
        this.executeLines(toLogicalLines(commands), false);
    }

    /**
     * 从一个目标中获取对象获取某个属性，获取到该对象以后，将其name放入到slot中
     * @param params 
     */
    private executeGetObject(params: Map<string, string>): void {
        const objName = params.get('name') || params.get('n') || params.get('object') || params.get('o');
        if (!objName) {
            throw new Error('GETOBJ command requires name parameter');
        }

        const propertyName = params.get('property') || params.get('p');
        if (!propertyName) {
            throw new Error('GETOBJ command requires property parameter');
        }

        const slotName = params.get('slot') || params.get('s');
        if (!slotName) {
            throw new Error('GETOBJ command requires slot parameter');
        }

        // 检查对象是否存在
        const obj = this.getObject(objName);
        if (!obj) {
            throw new Error(`Object ${objName} not found`);
        }

        // 获取对象的属性值
        if (!(propertyName in obj)) {
            throw new Error(`Property ${propertyName} does not exist on object ${objName}`);
        }

        const value = (obj as any)[propertyName]; // 使用类型断言获取属性值

        // 判断目标对象是否是几何对象
        if (value instanceof GeometricObject) {
            const valueName = (value as any).name; // 获取属性的name
            // 将对象的name存入槽位
            this.state.slots.set(slotName, valueName);

            // 输出对象信息
            console.log(`Retrieved object: ${objName}`, obj);
        } else {
            // 如果是数值，字符串，Boolean，直接存入槽位
            if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
                this.state.slots.set(slotName, value);
                // console.log(`Stored value '${value}' in slot ${slotName}`);
            }
        }
    }

    /**
     * `SETLABEL` —— 给任意对象改名（设置显示标签）。
     *
     * 用法：
     *   SETLABEL name=P label=点P                 # 单个对象
     *   SETLABEL obj=A,B label=端点 draw=true     # 多个对象用同一个标签
     *   SETLABEL name=P label=                    # 空标签 = 不显示
     *
     * 与 `SET` 的区别：`SET` 改的是**全局默认值**（之后新画的对象才受影响），
     * `SETLABEL` 改的是**某个已存在对象的标签**。
     *
     * 与 `CREATE ... label=` 的区别：那条挂在创建行上，只对几何对象有效，且派生对象
     * （`CREATE TANGENT` 顺带建出的 `T2` / `T2_tan`、自动命名的 `seg_2` …）在脚本里
     * 根本没有独立定义行，压根没地方写 `label=`。`SETLABEL` 按名字定位，对**任何**
     * 已注册对象都成立 —— 这正是它存在的理由。
     *
     * 实现落在 `state.labelOverrides`（对象名 -> 标签），绘制时优先于脚本里的 `label=`。
     * 不去改写脚本源码：解释器只负责解释，脚本改写是编辑层（`dslPropertySync`）的职责，
     * 混在一起会让「重跑脚本」和「改脚本」互相打架。
     */
    private executeSetLabel(params: Map<string, string>, rawCommand: string): void {
        // 对象名可以写成 name= / n= / obj= / o=，与 GETOBJ / DRAW 保持一致的习惯。
        const rawTargets = params.get('name') ?? params.get('n')
            ?? params.get('obj') ?? params.get('o');

        if (rawTargets === undefined) {
            throw new Error('SETLABEL command requires name parameter (例如 SETLABEL name=P label=点P)');
        }

        // `label` 允许为空串（= 不显示），所以不能用 `??` 的短路逻辑去判「有没有写」——
        // 必须区分「没写 label=`」和「写了 label= 但值是空的」。params 里有键就说明写了。
        const labelKey = ['label', 'l', 'text', 't'].find(key => params.has(key));
        if (labelKey === undefined) {
            throw new Error('SETLABEL command requires label parameter');
        }

        // 转义要按**原始命令行**判断，不能看 params 里的值 ——
        // `parseParameters` 早把引号剥掉了，`label="a\nb"` 与 `label=a\nb` 解析出来
        // 一模一样，光看值无法区分「该还原换行」还是「该保留反斜杠」。
        const label = this.readRawLabelValue(rawCommand, labelKey)
            ?? (params.get(labelKey) ?? '');

        const names = rawTargets.split(',').map(item => item.trim()).filter(Boolean);
        if (names.length === 0) {
            throw new Error('SETLABEL command requires at least one object name');
        }

        const missing: string[] = [];
        for (const name of names) {
            const obj = this.getObject(name);
            if (!obj) {
                missing.push(name);
                continue;
            }
            this.state.labelOverrides.set(obj.name, label);
        }

        // 一个都没找到才报错；部分命中就按命中的来，并把缺失的名字提示出来 ——
        // 派生对象的名字（`T2`、`seg_2`）用户不一定记得准，报错信息里带上才有用。
        if (missing.length === names.length) {
            throw new Error(`SETLABEL: 对象不存在: ${missing.join(', ')}`);
        }

        if (missing.length > 0) {
            this.state.onMessage?.(
                'warn',
                this.state.currentCommandLine,
                `SETLABEL: 以下对象不存在，已跳过: ${missing.join(', ')}`,
            );
        }

        const display = label === '' ? '(空 = 不显示)' : label.replace(/\n/g, '\\n');
        this.state.onMessage?.(
            'info',
            0,
            `Set label of ${names.filter(n => !missing.includes(n)).join(', ')} to ${display}`,
        );
    }

    /**
     * 从**原始命令行**里取 `<key>=` 后面的标签文本，并按引号情况决定是否反转义。
     *
     * 为什么绕开 `params`：`parseParameters` 会把引号剥掉再存值，所以
     * `label="a\nb"` 和 `label=a\nb` 解析出来完全相同。而这两者的语义必须不同 ——
     * 前者是用户明确要一个换行，后者可能就是想打反斜杠。原始命令行里还留着引号，
     * 是唯一能区分二者的地方。
     *
     * 转义必须**单趟**替换：分多次 replace 会踩「`\\` 先变 `\`、再碰上 n 就成了换行」的坑。
     */
    private readRawLabelValue(rawCommand: string, key: string): string | undefined {
        if (!rawCommand) return undefined;

        // 匹配 `key=` 后紧跟的「带引号串」或「裸串」，值的结束位置与 parseParameters 同规则：
        // 裸串一直吃到「空白 + 下一个 key=」或行尾。
        const pattern = new RegExp(`(?:^|\\s)${key}\\s*=\\s*`, 'i');
        const match = pattern.exec(rawCommand);
        if (!match) return undefined;

        let cursor = match.index + match[0].length;
        const quote = rawCommand[cursor];

        if (quote === '"' || quote === "'") {
            cursor++;
            let end = cursor;
            while (end < rawCommand.length && rawCommand[end] !== quote) {
                if (rawCommand[end] === '\\' && end + 1 < rawCommand.length) end++; // 跳过被转义的字符
                end++;
            }
            const inner = rawCommand.slice(cursor, end);
            return inner.replace(/\\(.)/g, (_, char) => {
                if (char === 'n') return '\n';
                if (char === 't') return '\t';
                if (char === 'r') return '\r';
                return char;
            });
        }

        // 裸值：读到下一个 ` key=` 之前
        const rest = rawCommand.slice(cursor);
        const nextKey = /\s+\w+\s*=/.exec(rest);
        return (nextKey ? rest.slice(0, nextKey.index) : rest).trim();
    }

    // 执行计算指令
    private executeCalculate(params: Map<string, string>): void {
        const expression = params.get('expression') || params.get('e');
        if (!expression) {
            throw new Error('CALCULATE command requires expression parameter');
        }

        // 解析表达式
        const result = this.executeSlotExpression(expression);
        const slotName = params.get('slot') || params.get('s');
        if (slotName) {
            this.state.slots.set(slotName, result);
        }

        // console.log(`Calculated value for expression '${expression}' stored in slot ${slotName}: ${result}`);
    }

    /**
     * 提取字符串中的所有嵌套表达式，表达式以 { 和 } 包围，支持多层嵌套。
     * 如果遇到不完整的平衡组，左边的 '{' 会被当作普通字符处理。
     *
     * @param {string} text 需要解析的原始字符串。
     * @returns {string[]} 包含所有提取出的完整表达式的字符串数组。
     */
    // 找出文本里的槽位表达式 `{...}`。
    // LaTeX 片段内部的 `{}` 是数学语法（例如 `\frac{a}{b}`），
    // 必须跳过，否则 `{a}` 会被当成槽位去求值并报 "Variable 'a' not found"。
    extractExpressions(text: string): string[] {
        const expressions: string[] = [];
        const stack: number[] = [];
        let start = -1;
        const inLatex = latexRegionMask(text);

        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (inLatex[i]) {
                // 位于 LaTeX 片段内：不参与槽位识别，
                // 同时丢弃已经开始的半个表达式，避免跨段拼接。
                if (stack.length > 0) {
                    stack.length = 0;
                    start = -1;
                }
                continue;
            }
            if (char === '{') {
                if (stack.length === 0) {
                    // 找到一个潜在的表达式起点
                    start = i;
                }
                stack.push(i);
            } else if (char === '}') {
                if (stack.length > 0) {
                    stack.pop();
                    if (stack.length === 0) {
                        // 找到一个完整的顶层表达式
                        expressions.push(text.substring(start, i + 1));
                        start = -1; // 重置开始位置
                    }
                } else {
                    // 如果没有匹配的左括号，当前 '}' 会被忽略
                }
            }
        }
        return expressions;
    }

    private executeText(params: Map<string, string>, rawCommand: string, lineNumber: number): void {
        if (!this.state.ctx || !this.state.canvas) return;

        const textObjectName = this.getTextObjectName(params, lineNumber);
        const x = this.getPreviewProperty(textObjectName, 'x') ?? this.getNumberValue(params, 'x');
        const y = this.getPreviewProperty(textObjectName, 'y') ?? this.getNumberValue(params, 'y');
        if (x === undefined || y === undefined) {
            throw new Error('TEXT command requires x and y parameters');
        }

        const textMatch = /\b(?:text|t)=([\s\S]*?)(?=\s+(?:color|c|fontSize|fs|fontFamily|font|fontStyle|fontWeight|backgroundColor|bgc|padding|p)=|$)/i.exec(rawCommand);
        if (!textMatch) {
            throw new Error('TEXT command requires text parameter');
        }

        let text = textMatch[1].trim();
        // 只有**带引号**的内容才反转义。
        // 画布右键「文字」对话框写出的就是 `text="..."`，内容里的换行/引号/反斜杠都经过转义
        // （`\n` / `\"` / `\\`），不还原的话用户会看到一堆反斜杠；
        // 而老脚本里裸写的 `text=AB` 或含 `\n` 字面量的写法要保持原样，所以不碰未加引号的情况。
        const quoted = (text.startsWith('"') && text.endsWith('"'))
            || (text.startsWith("'") && text.endsWith("'"));
        if (quoted) {
            // 单趟替换：一次扫过，`\\n` 这种「转义的反斜杠 + n」不会被误当成换行。
            // 分多次 replace 会踩这个坑 —— `\\` 先变 `\`，再碰上 n 就成了换行。
            //
            // 只还原**写出方真正会转义**的那几种序列（\\ \n \t \r \" \'）：
            // 其余反斜杠必须原样保留，否则 LaTeX 会被吃掉 —— `\frac` / `\left` / `\sqrt`
            // 里的反斜杠不是转义前缀，按「`\x` → `x`」处理会变成 `frac` / `left` / `sqrt`，
            // 公式直接崩成乱码（曾造成「非选中时公式末尾缺一段」）。
            text = text.slice(1, -1).replace(/\\(.)/g, (match: string, char: string) => {
                if (char === 'n') return '\n';
                if (char === 't') return '\t';
                if (char === 'r') return '\r';
                if (char === '"' || char === "'" || char === '\\') return char;
                return match; // 未知转义（含 LaTeX 命令）原样保留
            });
        }
        // 槽位替换 `{表达式}` → 求值结果。
        //
        // 两个防御点（都曾造成「整条 TEXT 一个字都不显示」）：
        //   1. `{}` 是空表达式，`calculate('')` 会抛错。用户在 LaTeX 后面随手写个 `{}`
        //      （或公式末尾本来就有花括号）就会把整条指令带崩 —— 空串直接跳过。
        //   2. 单个槽位求值失败（变量未定义 / 语法错）不应该连累整段文字：
        //      保留原样的 `{...}` 文本比什么都不画更有利于用户定位问题。
        for (const expression of this.extractExpressions(text)) {
            const slotName = expression.slice(1, -1).trim();
            if (!slotName) continue;
            let slotValue: number | undefined;
            try {
                slotValue = this.executeSlotExpression(slotName);
            } catch {
                continue; // 求值失败就保留原文，不让整条 TEXT 挂掉
            }
            if (slotValue !== undefined) text = text.replace(expression, slotValue.toString());
        }

        const fontSize = this.getNumberValue(params, 'fontSize')
            || this.getNumberValue(params, 'fs')
            || this.state.defaultOptions.labelSize;
        const fontFamily = params.get('fontFamily') || params.get('font') || 'Arial';
        const fontStyle = params.get('fontStyle') || 'normal';
        const fontWeight = params.get('fontWeight') || 'normal';
        const baseColor = this.parseColor(params, 'color')
            || this.parseColor(params, 'c')
            || this.state.defaultOptions.labelColor;
        const color = this.state.selectedObjectNames.has(textObjectName) || this.state.selectedObjectName === textObjectName
            ? SELECTED_OBJECT_COLOR
            : baseColor;
        const padding = this.getNumberValue(params, 'padding')
            || this.getNumberValue(params, 'p')
            || 0;
        const transform = this.getTextRenderTransform();
        const screenPoint = toScreenPoint(x, y, transform);

        const ctx = this.state.ctx;
        // SVG 导出没有真正的 Canvas 上下文，drawKatex 只在 SvgRenderContext 上有意义。
        const isSvg = !this.state.contextPreTransformed;

        ctx.save();
        ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;

        // 先把 text 按换行切成若干行；每一行内部再切成普通文本 / LaTeX 片段并测宽。
        // 单行是绝大多数情况，多行来自画布右键「文字」对话框里按了回车。
        const lines = text.split('\n');

        interface Layout {
            kind: 'text' | 'latex';
            value: string;
            displayMode?: boolean;
            width: number;
            height: number;
            ascent: number;
            descent: number;
            x: number;
        }
        // 每行的布局，外加该行的整体尺寸 —— 多行时要按行的最大宽度对齐背景框、
        // 按每行自己的 ascent 决定基线，不能拿一个全局值糊弄。
        interface LineLayout {
            layouts: Layout[];
            width: number;
            ascent: number;
            descent: number;
        }

        const lineLayouts: LineLayout[] = [];
        for (const lineText of lines) {
            const parts = splitLatexParts(lineText);
            const layouts: Layout[] = [];
            let cursorX = screenPoint.x;
            let lineAscent = 0;
            let lineDescent = 0;
            for (const part of parts) {
                if (part.kind === 'text') {
                    const value = part.value;
                    const m = ctx.measureText(value);
                    const width = m.width;
                    const ascent = (m as any).fontBoundingBoxAscent ?? fontSize * 0.8;
                    const descent = (m as any).fontBoundingBoxDescent ?? fontSize * 0.2;
                    layouts.push({ kind: 'text', value, width, height: ascent + descent, ascent, descent, x: cursorX });
                    cursorX += width;
                    lineAscent = Math.max(lineAscent, ascent);
                    lineDescent = Math.max(lineDescent, descent);
                } else {
                    const measured = this.measureKatexForLayout(part.value, fontSize, color, part.displayMode === true);
                    const ascent = measured.height * 0.75;
                    const descent = measured.height * 0.25;
                    layouts.push({
                        kind: 'latex',
                        value: part.value,
                        displayMode: part.displayMode,
                        width: measured.width,
                        height: measured.height,
                        ascent,
                        descent,
                        x: cursorX,
                    });
                    cursorX += measured.width + 2;
                    lineAscent = Math.max(lineAscent, ascent);
                    lineDescent = Math.max(lineDescent, descent);
                }
            }
            // 空行也要占一行高度，否则连按两次回车会被压缩掉，用户看到的行距和输入不一致。
            if (layouts.length === 0) {
                lineAscent = fontSize * 0.8;
                lineDescent = fontSize * 0.2;
            }
            lineLayouts.push({ layouts, width: cursorX - screenPoint.x, ascent: lineAscent, descent: lineDescent });
        }

        // 行高取字号的一点二倍：太挤会和上行下伸部分打架，太松又不像一段文字。
        const lineHeight = fontSize * 1.2;
        const totalWidth = Math.max(...lineLayouts.map(line => line.width), 0);
        const firstAscent = lineLayouts[0]?.ascent ?? fontSize * 0.8;
        // 整个文本块的总高：第一行的上伸 + 中间行距 + 最后一行的下伸。
        const totalHeight = (lineLayouts.length - 1) * lineHeight + firstAscent + (lineLayouts[lineLayouts.length - 1]?.descent ?? 0);

        this.state.textElements.set(textObjectName, {
            name: textObjectName,
            text,
            x,
            y,
            width: totalWidth,
            ascent: firstAscent,
            descent: totalHeight - firstAscent,
            lineNumber,
        });
        this.state.textHitRegions.push({
            objectName: textObjectName,
            x,
            y,
            width: totalWidth,
            ascent: firstAscent,
            descent: totalHeight - firstAscent,
        });

        // 背景框（可选）。多行时框住整个文本块，不能只框第一行。
        const backgroundColor = this.parseColor(params, 'backgroundColor')
            || this.parseColor(params, 'bgc');
        if (backgroundColor && backgroundColor !== 'transparent' && backgroundColor !== 'none') {
            ctx.fillStyle = backgroundColor;
            ctx.fillRect(
                screenPoint.x - padding,
                screenPoint.y - firstAscent - padding,
                totalWidth + padding * 2,
                totalHeight + padding * 2,
            );
            ctx.fillStyle = color;
        }

        ctx.fillStyle = color;
        for (let lineIndex = 0; lineIndex < lineLayouts.length; lineIndex++) {
            const line = lineLayouts[lineIndex];
            // 每一行的基线 = 第一行的基线往下挪若干行。用「第一行 ascent + 行距×n」
            // 而不是拿本行 ascent 累加，行距才均匀（不然 LaTeX 行会把下面顶开）。
            const lineBaseline = screenPoint.y + lineIndex * lineHeight;
            for (const layout of line.layouts) {
                if (layout.kind === 'text') {
                    ctx.fillText(layout.value, layout.x, lineBaseline);
                    continue;
                }
                // LaTeX 段：基线在 lineBaseline，片段顶端放在 lineBaseline - ascent 处，
                // 与同行的普通文字顶部齐平。
                const top = lineBaseline - layout.ascent;
                if (isSvg) {
                    const svgCtx = ctx as unknown as { drawKatex: (fragment: string, x: number, y: number) => void };
                    if (typeof svgCtx.drawKatex === 'function') {
                        const { fragment } = renderKatexToSvgFragment(layout.value, fontSize, color, {
                            includeCss: false,
                            displayMode: layout.displayMode === true,
                        });
                        svgCtx.drawKatex(fragment, layout.x, top);
                        continue;
                    }
                    // 兜底：纯文本 fallback
                    ctx.fillText(`$${layout.value}$`, layout.x, lineBaseline);
                    continue;
                }
                // Canvas 路径：先看缓存有没有渲染好的离屏 canvas
                const cached = getCachedKatexCanvas(layout.value, fontSize, color, layout.displayMode === true);
                if (!cached) {
                    prefetchKatexToCanvas(layout.value, fontSize, color, layout.displayMode === true);
                    // 还没渲好：用原文当占位，避免整段布局塌掉。
                    //
                    // 占位文本必须**画在 layout.width 之内**：`\frac{a}{b}` 这类源码
                    // 原样铺开比渲染后的公式宽得多（实测约 2.2 倍），直接 fillText 会
                    // 冲出预留盒、压到后面的内容上，看起来就像「最后一段被截断了」。
                    // 这里按预留宽度水平缩放一下，让占位恰好占满这段的位置；
                    // 缓存就绪后会被真正的公式位图替换。
                    const previousFont = ctx.font;
                    ctx.font = `italic ${fontWeight} ${fontSize}px ${fontFamily}`;
                    const placeholderText = `$${layout.value}$`;
                    const placeholderWidth = ctx.measureText(placeholderText).width;
                    if (placeholderWidth > 0 && layout.width > 0) {
                        ctx.save();
                        ctx.translate(layout.x, lineBaseline);
                        ctx.scale(layout.width / placeholderWidth, 1);
                        ctx.fillText(placeholderText, 0, 0);
                        ctx.restore();
                    } else {
                        ctx.fillText(placeholderText, layout.x, lineBaseline);
                    }
                    ctx.font = previousFont;
                } else {
                    // 按位图的**原始像素尺寸**绘制（3 参形式）。
                    //
                    // 不要传 layout.width / layout.height：位图是 `Math.ceil(measureKatex(...))`，
                    // 比测量值大 0~1px，而位图里的字形（尤其斜体末字母的伸出部分）是顶满像素盒的。
                    // 按略小的测量值去画等于把内容缩一点，右边缘最后那点会被裁掉 ——
                    // 表现出来正好是「公式末尾缺一点」。
                    ctx.drawImage(cached, layout.x, top);
                }
            }
        }
        ctx.restore();
    }

    // 同步测 LaTeX 尺寸。Canvas 与 SVG 都走这里，
    // Node 离线导出由 katexRender 内部回退到字符数近似。
    private measureKatexForLayout(latex: string, fontSize: number, color: string, displayMode = false): { width: number; height: number } {
        return measureKatex(latex, fontSize, color, displayMode);
    }

    /**
     * 「逻辑坐标 -> 渲染坐标」的变换。
     *
     * Canvas 路径只算到外层矩阵**之前**（ctx 自己带平移/缩放/旋转）；
     * SVG 导出路径没有外层矩阵，所以把 renderScale / renderOffset / renderRotation 全并进来，
     * 直接一步算到最终输出坐标。
     */
    private getTextRenderTransform(pixelScale?: number): DrawTransform {
        const viewScale = this.state.defaultOptions.scale;
        const baseOffsetX = this.state.canvas!.width / 2 - this.state.defaultOptions.centerX * viewScale;
        const baseOffsetY = this.state.canvas!.height / 2 - this.state.defaultOptions.centerY * viewScale;
        const canvas = this.state.canvas!;
        return {
            scale: this.state.renderScale * viewScale,
            offsetX: this.state.renderScale * baseOffsetX + this.state.renderOffsetX,
            offsetY: this.state.renderScale * baseOffsetY + this.state.renderOffsetY,
            ...(pixelScale != null ? { pixelScale } : {}),
            // Canvas 路径的旋转由 ctx 矩阵施加，这里必须保持 0，否则会转两遍；
            // SVG 导出没有外层矩阵，才把旋转（脚本声明的 + 交互式的）烘进坐标。
            rotation: this.state.contextPreTransformed ? 0 : this.getTotalRotationRadians(this.state.renderRotation),
            pivot: viewPivot(canvas.width, canvas.height),
        };
    }

    private executePrint(params: Map<string, string>, rawCommand: string, lineNumber: number): void {
        // 从原始命令中获取message=开头或者m=开头后面所有的字符串(需要忽略message或者m的大小写)，这里由于需要支持空格，所以不能使用params解析
        const reg = /\b(message|m)=(.*)/i
        const messageMatch = reg.exec(rawCommand);
        if (!messageMatch) {
            return;
        }

        let message = messageMatch[2];
        // 这里需要处理表达式中的内容
        const expressMatchs = this.extractExpressions(message)
        if (expressMatchs.length > 0) {
            expressMatchs.forEach(slot => {
                const slotName = slot.slice(1, -1); // 去掉{}
                const slotValue = this.executeSlotExpression(slotName); // 解析槽位表达式
                if (slotValue !== undefined) {
                    message = message.replace(slot, slotValue.toString());
                } else {
                    console.warn(`Slot ${slotName} not found in message at line ${lineNumber}`);
                }
            });
        }

        // 输出消息
        console.log(`Print at line ${lineNumber}: ${message}`);
        this.state.onMessage?.('info', lineNumber, message);
    }

    private static parseBoolean(value: string | undefined): boolean {
        if (value === undefined) return false;
        return value.toLowerCase() === 'true';
    }

    private executeSlotExpression(expression: string): number {
        // 解析槽位表达式，支持简单的加减乘除

        // 处理表达式中存在的负号，在前面加一个0，例如 -3 + (6 * (-{x} + 2 * 3)) ，替换成 0 - 3 + (6 * (0- {x} + 2 * 3))
        expression = expression.replace(/(^|\()\s*-\s*/g, '$10 - ');

        return calculate(expression, this.state.slots, this.state.functions);
    }

    private getNumberValue(params: Map<string, string>, key: string): number | undefined {
        const value = params.get(key);
        if (value === undefined) {
            return undefined; // 如果没有提供该参数，则返回undefined
        }

        // 如果值是一个槽位表达式{slot}，解析它
        if (value.startsWith('{') && value.endsWith('}')) {
            const slotExpression = value.slice(1, -1);

            const slotValue = this.executeSlotExpression(slotExpression);
            return slotValue;
        }

        const num = parseFloat(value);
        if (isNaN(num)) {
            return undefined;
        }
        return num;
    }

    // 几何指令实现示例（需要根据实际的几何对象类来实现）
    private createPoint(params: Map<string, string>): void {
        const name = params.get('name');
        const parsedX = this.getNumberValue(params, 'x');
        const parsedY = this.getNumberValue(params, 'y');
        const parsedRadius = this.getNumberValue(params, 'radius');
        const x = name ? this.getPreviewProperty(name, 'x') ?? parsedX ?? 0 : parsedX ?? 0;
        const y = name ? this.getPreviewProperty(name, 'y') ?? parsedY ?? 0 : parsedY ?? 0;
        // radius 是屏幕像素值；不写就用默认点半径，跟解释器自己算出来的点（中点、垂足、
        // 交点…）保持一致。**不要**再乘 VIEW scale，否则大 scale 下点会变成巨大的圆盘。
        // 不写 radius 时**不要**在这里补默认值：留给 Point 走 explicitRadius=false 分支，
        // 由 resolvePointRadius 用 `SET item=pointRadius`（屏幕像素）统一决定。
        // 这样 CREATE POINT 和解释器自己算出来的点（中点、交点…）大小口径一致。
        const radius = name ? this.getPreviewProperty(name, 'radius') ?? parsedRadius : parsedRadius;
        // 不写 real= 时用 `SET item=pointFill`（默认 false → 空心点，与历史行为一致）。
        const real = params.has('real')
            ? GeometryDSLInterpreter.parseBoolean(params.get('real'))
            : this.state.defaultOptions.pointFill;
        // 冻结属性：写进脚本后由这里解析回来，画布据此拒绝拖动（见 isObjectFrozen）。
        const frozen = GeometryDSLInterpreter.parseBoolean(params.get('frozen'));

        if (!name) {
            throw new Error('POINT command requires name parameter');
        }

        // 这里需要创建实际的Point对象
        const point = new Point(name, x, y, radius, real);
        point.frozen = frozen;
        this.state.objects.set(name, point);

        const draw = params.get('draw');
        if (draw != null && draw == 'true' && this.state.ctx) {
            this.collectDraw(params, point);
        }
    }

    /**
     * 从 DSL 的 `cutPoints=A,B`（兼容 cutoffPoints/cuts）解析截止点引用。
     *
     * 每个条目可以带方向前缀：
     *   - `A`  → 不带方向，走交替语义；
     *   - `+A` → 隐藏 A 的正方向一侧，保留参数 ≤ A 的部分；
     *   - `-A` → 隐藏 A 的负方向一侧，保留参数 ≥ A 的部分。
     *
     * `-A,+B` 就是把直线截成线段 [A,B]；`+A,-B` 则是挖掉中间一段。
     * 只要有一个条目带方向，整条线就走「各砍一侧」语义（见 LinearObject）。
     */
    private applyLinearCutPoints(
        params: Map<string, string>,
        object: LinearObject,
    ): void {
        const raw = params.get('cutPoints') || params.get('cutoffPoints') || params.get('cuts');
        if (raw === undefined || raw.trim() === '') return;
        const cuts: LinearCutPoint[] = [];
        const pending: Array<{ name: string; side: CutSide }> = [];
        for (const rawEntry of raw.split(',')) {
            const entry = rawEntry.trim();
            if (!entry) continue;
            // 前缀和点名之间允许有空格（`- A`），方便手写。
            const matched = /^([+-]?)\s*(.+)$/.exec(entry);
            if (!matched) continue;
            const side: CutSide = matched[1] === '+' ? 'right' : matched[1] === '-' ? 'left' : null;
            const pointName = matched[2].trim();
            if (!pointName) continue;
            const point = this.getObject(pointName);
            if (point === undefined) {
                // 还没定义：先记下来，等脚本跑完再补 —— 线上的点、交点都只能在这条线之后创建。
                pending.push({ name: pointName, side });
                continue;
            }
            if (!(point instanceof Point)) {
                throw new Error(`cutPoints reference ${pointName} is not a point`);
            }
            cuts.push({ point, side });
        }
        object.setCutPoints(cuts);
        if (pending.length > 0) {
            // 登记到待解析表：**与这条线这次画不画无关**。即使当前是 draw=false，
            // 后面一条 `DRAW obj=X` 仍可能把它画出来，那时截止点必须是全的。
            this.state.pendingCutResolutions.set(object.name, {
                object,
                cuts: pending,
                lineNumber: this.state.currentCommandLine,
            });
        }
    }

    /**
     * 收集一个「create 时写了 draw=true」的几何对象，等脚本跑完统一绘制。
     *
     * **为什么所有几何对象都后置**：截止点、交点、线上取点这类东西天然是前向引用
     * （它们只能建在引用它们的对象之后）。逐个特判「谁需要延迟」既容易漏、又难维护，
     * 干脆几何对象一律不在 create 时画，等对象表建完再一次性画。
     * 这样任何对象都能引用在它后面才创建的东西，不必为每种前向引用各写一套。
     *
     * 只对几何对象这么做：TEXT / AXIS 之类仍立即绘制（它们不参与几何引用，
     * 且通常要求压在图形之上）。
     *
     * 代价：脚本里显式写的 `DRAW obj=X` 会排在所有 `draw=true` 对象**下面**
     * （前者在指令位置就画了，后者统一等到最后）。要调整层级就用 `DRAW obj=X` 显式画。
     *
     * 调用点都在 `if (draw === 'true' && this.state.ctx)` 守卫里，所以这里不再重复判断。
     */
    private collectDraw(
        params: Map<string, string>,
        object: GeometricObject,
    ): void {
        // 标签**只认脚本里显式写的 `label=` / `l=`**，不再回落到对象名：
        // 名字是给引用用的标识符（自动生成的还是 `perp1` 这种），画到图上没有意义。
        // 「画不画」的总开关在 `drawObject` 里判（只有那里知道对象是点还是别的），
        // 这里只负责把值取出来存进待绘队列。
        const effectiveLabel = params.get('label') ?? params.get('l');

        const existing = this.state.pendingDraws.find(entry => entry.object === object);
        if (existing) {
            // 走到这里基本只剩「同名对象被重建」：新定义应当**完全取代**旧样式，
            // 所以整体替换而不是叠加（叠加会把上一个定义的 width/color 带过来）。
            // `DRAW` / `FILL` 改样式不走这里，走 `mergePendingDraw`。
            existing.params = new Map(params);
            if (effectiveLabel !== undefined) existing.label = effectiveLabel;
            return;
        }
        this.state.pendingDraws.push({
            // 复制一份：指令表在 execute 之间会重建，留着引用没有意义，但复制成本极低。
            params: new Map(params),
            object,
            label: effectiveLabel,
        });
    }

    /**
     * 给一个**已经在待绘队列里**的对象改样式 —— `DRAW obj=X` / `FILL obj=X` 走这里。
     *
     * 和 `collectDraw` 的区别只在「已有队列项时怎么合并」：`collectDraw` 是整体替换
     * （创建点用它，同名重建时新定义应当完全生效），这里是在原有样式上**叠加**。
     * 文档里写的也是「只覆盖其样式」：create 上写的 `width` / `radius` 不该因为
     * 后面一条只改颜色的 `DRAW` 就丢掉。
     *
     * 对象还不在队列里时退化成入队 —— `DRAW` 命中「截止点尚未解析」的情况走这条。
     */
    private mergePendingDraw(
        params: Map<string, string>,
        object: GeometricObject,
        label: string | undefined,
    ): void {
        const existing = this.state.pendingDraws.find(entry => entry.object === object);
        if (existing) {
            for (const [key, value] of params) existing.params.set(key, value);
            if (label !== undefined) existing.label = label;
            return;
        }
        this.state.pendingDraws.push({
            params: new Map(params),
            object,
            label,
        });
    }

    /**
     * 把创建时解析不出来的截止点补进对象。
     *
     * 这时整份脚本已经跑完，线上取的点、交点都建出来了，绝大多数引用都能解析。
     * 仍然缺失的只记一条 warning，让这条线按完整绘制 —— 不静默丢线。
     */
    private resolvePendingCuts(): void {
        const resolutions = Array.from(this.state.pendingCutResolutions.values());
        this.state.pendingCutResolutions.clear();

        for (const entry of resolutions) {
            const missing: string[] = [];
            const cuts: LinearCutPoint[] = [...entry.object.cutPoints];
            for (const item of entry.cuts) {
                const point = this.getObject(item.name);
                if (point instanceof Point) cuts.push({ point, side: item.side });
                else missing.push(item.name);
            }
            entry.object.setCutPoints(cuts);

            if (missing.length > 0) {
                this.state.onMessage?.(
                    'warning',
                    entry.lineNumber,
                    `${entry.object.name} 的 cutPoints 引用了不存在的点：${missing.join('、')}，该线按完整绘制`,
                );
            }
        }
    }

    /**
     * 画掉所有收集到的对象。由 `executeLines` 回到最外层时自动调用 ——
     * 相当于脚本末尾隐式补了一条 `DRAW`，不需要用户在代码里显式写。
     *
     * 先解析截止点再绘制：顺序反了就会照着「还没补全截止点」的样子画，
     * 而画布只增不减，之后盖不掉。
     * 绘制顺序 = 创建顺序，所以 z 序与「逐个立即绘制」时一致。
     */
    private flushPendingDraws(): void {
        this.resolvePendingCuts();

        const pending = this.state.pendingDraws;
        this.state.pendingDraws = [];
        if (pending.length === 0 || !this.state.ctx) return;

        const ctx = this.state.ctx;
        for (const entry of pending) {
            this.drawObject(ctx, entry.params, entry.object, entry.label);
        }
    }

    private createLine(params: Map<string, string>): void {
        const name = params.get('name');
        const p1Name = params.get('p1');
        const p2Name = params.get('p2');

        if (!name || !p1Name || !p2Name) {
            throw new Error('LINE command requires name, p1, and p2 parameters');
        }

        const p1 = this.getObject(p1Name);
        const p2 = this.getObject(p2Name);

        if (!p1 || !p2) {
            throw new Error(`Points ${p1Name} or ${p2Name} not found`);
        }

        // 这里需要创建实际的Line对象
        const line = new Line(name, p1 as Point, p2 as Point);
        this.applyLinearCutPoints(params, line);
        this.state.objects.set(name, line);
        if (params.get('draw') === 'true' && this.state.ctx) {
            this.collectDraw(params, line);
        }
    }

    private createSegment(params: Map<string, string>): void {
        const name = params.get('name');
        const p1Name = params.get('p1');
        const p2Name = params.get('p2');

        if (!name || !p1Name || !p2Name) {
            throw new Error('SEGMENT command requires name, p1, and p2 parameters');
        }

        const p1 = this.getObject(p1Name);
        const p2 = this.getObject(p2Name);

        if (!p1 || !p2) {
            throw new Error(`Points ${p1Name} or ${p2Name} not found`);
        }

        // 这里需要创建实际的Segment对象
        const segment = new Segment(name, p1 as Point, p2 as Point);
        this.applyLinearCutPoints(params, segment);
        this.state.objects.set(name, segment);
        if (params.get('draw') === 'true' && this.state.ctx) {
            this.collectDraw(params, segment);
        }
    }

    // 创建射线
    private createRay(params: Map<string, string>): void {
        // 实现射线创建
        const name = params.get('name');
        // 顶点
        const vertexName = params.get('vertex') || params.get('v');
        // 其他任意一点
        const p1Name = params.get('p1');

        if (!name || !vertexName || !p1Name) {
            throw new Error('RAY command requires name, vertex, and p1 parameters');
        }

        const vertex = this.getObject(vertexName);
        const p1 = this.getObject(p1Name);

        if (!vertex || !p1) {
            throw new Error(`Points ${vertexName} or ${p1Name} not found`);
        }

        // 这里需要创建实际的Ray对象
        const ray = new Ray(name, vertex as Point, p1 as Point);
        this.applyLinearCutPoints(params, ray);
        this.state.objects.set(name, ray);
        if (params.get('draw') === 'true' && this.state.ctx) {
            this.collectDraw(params, ray);
        }
    }

    private createMidpoint(params: Map<string, string>): void {
        // 实现中点创建
        const name = params.get('name') || params.get('n');
        const p1Name = params.get('p1');
        const p2Name = params.get('p2');

        if (!name || !p1Name || !p2Name) {
            throw new Error('MIDPOINT command requires name, p1, and p2 parameters');
        }

        const p1Raw = this.getObject(p1Name);
        const p2Raw = this.getObject(p2Name);

        if (!p1Raw || !p2Raw) {
            throw new Error(`Points ${p1Name} or ${p2Name} not found`);
        }

        const p1 = p1Raw as Point;
        const p2 = p2Raw as Point;

        // 计算中点坐标
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;

        // 这里需要创建实际的Point对象作为中点
        const midpoint = new Point(name, midX, midY);
        this.state.objects.set(name, midpoint);

        const draw = params.get('draw');
        if (draw != null && draw == 'true' && this.state.ctx) {
            this.collectDraw(params, midpoint);
        }
    }

    private createPerpendicularFoot(params: Map<string, string>): void {
        const name = params.get('name') || params.get('n');
        // 文档里写的是 `from=` / `on=`（见 DSL_V6 2.2.4），实现里历史上只认 point/obj/line，
        // 于是照文档写的示例会直接报「need name, point and line」。这里把两套别名都收下，
        // 既修好文档示例，也不影响已经在用 point/obj 的脚本。
        const pointName = params.get('point') || params.get('p') || params.get('from') || params.get('f');
        const lineName = params.get('line') || params.get('l')
            || params.get('obj') || params.get('o') || params.get('on');

        if (!name || !pointName || !lineName) {
            throw new Error('PerpendicularFoot need name, point and line');
        }

        const point = this.getObject(pointName);
        const line = this.getObject(lineName);

        if (!point || !(point instanceof Point)) {
            throw new Error(`invalid point name : ${pointName}`);
        }

        if (!line || !(line instanceof LinearObject)) {
            throw new Error(`invalid line name : ${lineName}`);
        }

        // --- 以下是核心计算逻辑 ---

        // 1. 定义代表直线的向量 (v = p2 - p1)
        const vx = line.p2.x - line.p1.x;
        const vy = line.p2.y - line.p1.y;

        // 2. 定义从直线上一点p1指向源点的向量 (w = point - p1)
        const wx = point.x - line.p1.x;
        const wy = point.y - line.p1.y;

        // 3. 计算 w 在 v 上的投影长度比例 t
        // t = (w · v) / |v|²
        const dotProduct = (wx * vx) + (wy * vy);
        const lenSq = (vx * vx) + (vy * vy);

        // 如果lenSq为0，说明line的两个端点重合，垂足就是那个点
        const t = (lenSq === 0) ? 0 : dotProduct / lenSq;

        // 4. 计算垂足坐标 F = p1 + t * v
        const footX = line.p1.x + t * vx;
        const footY = line.p1.y + t * vy;

        // 5. 创建并存储新的垂足点对象
        const footPoint = new Point(name, footX, footY);
        this.state.objects.set(name, footPoint);

        const draw = params.get('draw');
        if (draw != null && draw == 'true' && this.state.ctx) {
            this.collectDraw(params, footPoint);
        }
    }

    private createReflectedPoint(params: Map<string, string>): void {
        // 1. 解析通用参数 (新点名称, 被操作的对象名称)
        const name = params.get('name') || params.get('n');
        const objName = params.get('obj') || params.get('o');

        if (!name || !objName) {
            throw new Error('ReflectedPoint requires a "name" and an "obj" to reflect.');
        }

        const objToReflect = this.getObject(objName);
        if (!objToReflect || !(objToReflect instanceof Point)) {
            throw new Error(`Object to reflect must be a valid point: ${objName}`);
        }

        // 2. 检查是中心对称还是轴对称
        const centerName = params.get('center') || params.get('c');
        const axisName = params.get('axis') || params.get('a');

        if (centerName) {
            // --- 情况一: 中心对称 ---
            const centerPoint = this.getObject(centerName);
            if (!centerPoint || !(centerPoint instanceof Point)) {
                throw new Error(`Center of reflection must be a valid point: ${centerName}`);
            }

            // 对称点 P' = C + (C - P) = 2C - P
            const reflectedX = 2 * centerPoint.x - objToReflect.x;
            const reflectedY = 2 * centerPoint.y - objToReflect.y;

            const reflectedPoint = new Point(name, reflectedX, reflectedY);
            this.state.objects.set(name, reflectedPoint);

            const draw = params.get('draw');
            if (draw != null && draw == 'true' && this.state.ctx) {
                this.collectDraw(params, reflectedPoint);
            }

        } else if (axisName) {
            // --- 情况二: 轴对称 ---
            const axisLine = this.getObject(axisName);
            if (!axisLine || !(axisLine instanceof LinearObject)) {
                throw new Error(`Axis of reflection must be a valid line: ${axisName}`);
            }

            // 轴对称的几何意义是：先找到从源点到对称轴的垂足 F，
            // 然后新点 P' 就是源点 P 关于垂足 F 的中心对称点。

            // 步骤 A: 计算垂足 F 的坐标 (使用向量投影法)
            const vx = axisLine.p2.x - axisLine.p1.x;
            const vy = axisLine.p2.y - axisLine.p1.y;
            const wx = objToReflect.x - axisLine.p1.x;
            const wy = objToReflect.y - axisLine.p1.y;

            const dotProduct = (wx * vx) + (wy * vy);
            const lenSq = (vx * vx) + (vy * vy);
            const t = (lenSq === 0) ? 0 : dotProduct / lenSq;

            const footX = axisLine.p1.x + t * vx;
            const footY = axisLine.p1.y + t * vy;

            // 步骤 B: 计算 P 关于垂足 F 的中心对称点 P' = 2F - P
            const reflectedX = 2 * footX - objToReflect.x;
            const reflectedY = 2 * footY - objToReflect.y;

            const reflectedPoint = new Point(name, reflectedX, reflectedY);
            this.state.objects.set(name, reflectedPoint);

            const draw = params.get('draw');
            if (draw != null && draw == 'true' && this.state.ctx) {
                this.collectDraw(params, reflectedPoint);
            }

        } else {
            // 3. 如果两个参数都没有，则抛出错误
            throw new Error('ReflectedPoint requires either a "center" point or an "axis" line parameter.');
        }
    }

    private createRotatedPoint(params: Map<string, string>): void {
        // 1. 解析所有必需的参数
        const name = params.get('name') || params.get('n');
        const objName = params.get('obj') || params.get('o');
        const centerName = params.get('center') || params.get('c');
        const angleStr = params.get('angle') || params.get('a');

        if (!name || !objName || !centerName || !angleStr) {
            throw new Error('RotatedPoint requires a "name", "obj", "center", and "angle".');
        }

        // 2. 获取并验证几何对象
        const objToRotate = this.getObject(objName);
        if (!objToRotate || !(objToRotate instanceof Point)) {
            throw new Error(`Object to rotate must be a valid point: ${objName}`);
        }

        const centerPoint = this.getObject(centerName);
        if (!centerPoint || !(centerPoint instanceof Point)) {
            throw new Error(`Center of rotation must be a valid point: ${centerName}`);
        }

        const angleInDegrees = this.getNumberValue(params, 'angle') || this.getNumberValue(params, 'a');
        if (angleInDegrees == null || isNaN(angleInDegrees)) {
            throw new Error(`Invalid angle value: ${angleStr}`);
        }

        // --- 以下是核心计算逻辑 ---

        // 3. 将角度从度转换为弧度，因为Math.sin/cos使用弧度
        const angleInRadians = angleInDegrees * (Math.PI / 180);

        // 4. 为了方便计算，先将坐标系平移，使旋转中心作为原点
        const translatedX = objToRotate.x - centerPoint.x;
        const translatedY = objToRotate.y - centerPoint.y;

        // 5. 应用标准的2D旋转公式
        // x' = x*cos(θ) - y*sin(θ)
        // y' = x*sin(θ) + y*cos(θ)
        const rotatedX_temp = translatedX * Math.cos(angleInRadians) - translatedY * Math.sin(angleInRadians);
        const rotatedY_temp = translatedX * Math.sin(angleInRadians) + translatedY * Math.cos(angleInRadians);

        // 6. 将坐标系平移回去，得到最终坐标
        const finalX = rotatedX_temp + centerPoint.x;
        const finalY = rotatedY_temp + centerPoint.y;

        // 7. 创建并存储新的旋转点对象
        const rotatedPoint = new Point(name, finalX, finalY);
        this.state.objects.set(name, rotatedPoint);

        const draw = params.get('draw');
        if (draw != null && draw == 'true' && this.state.ctx) {
            this.collectDraw(params, rotatedPoint);
        }
    }

    private TwoLinesIntersection(params: Map<string, string>, obj1Raw: LinearObject, obj2Raw: LinearObject, name: string, obj1Name: string, obj2Name: string): void {
        const intersection = obj1Raw.IntersectionWithLine(obj2Raw);
        if (!intersection) {
            throw new Error(`No intersection found between ${obj1Name} and ${obj2Name}`);
        }

        // 这里需要创建实际的Point对象作为交点
        const intersectionPoint = new Point(name, intersection.x, intersection.y);
        this.state.objects.set(name, intersectionPoint);

        const draw = params.get('draw');
        if (draw != null && draw == 'true' && this.state.ctx) {
            this.collectDraw(params, intersectionPoint);
        }
    }

    private TwoCirclesIntersection(params: Map<string, string>, obj1Raw: Circle, obj2Raw: Circle, name: string, obj1Name: string, obj2Name: string): void {
        const intersectionPoints = obj1Raw.getPointAtDistanceFromTarget(obj2Raw.center, obj2Raw.radius);
        if (intersectionPoints.length === 0) {
            throw new Error(`No intersection found between ${obj1Name} and ${obj2Name}`);
        }

        const names = name.split(',');

        if (intersectionPoints.length == 1) {
            // 如果只有一个交点（两圆相切）
            // 相切点如果已经被别的指令命名过，就不要再建一次，也不要覆盖它。
            const existing = this.findPoint(intersectionPoints[0].x, intersectionPoints[0].y);
            if (existing) {
                return;
            }
            const intersectionPoint = new Point(names[0], intersectionPoints[0].x, intersectionPoints[0].y);
            this.state.objects.set(intersectionPoint.name, intersectionPoint);

            const draw = params.get('draw');
            if (draw != null && draw == 'true' && this.state.ctx) {
                this.collectDraw(params, intersectionPoint);
            }

            return;
        }

        if (intersectionPoints.length == 2) {
            // 两个交点里，可能其中一个已经作为已命名点存在了（比如先点过、或用别的指令建过）。
            // 这时只补建「还没有的那个」—— 关键是不能拿已存在点的名字去建另一个交点：
            // 那样会用一个新坐标覆盖掉老点，把已经画在图上的点悄悄挪走。
            const findPoint0 = this.findPoint(intersectionPoints[0].x, intersectionPoints[0].y);
            const findPoint1 = this.findPoint(intersectionPoints[1].x, intersectionPoints[1].y);

            if (findPoint0 && findPoint1) {
                // 两个交点都已经命名了，不做处理
                return;
            }

            const draw = params.get('draw');

            if (findPoint0 || findPoint1) {
                // 已存在的是哪一个，就建另一个：坐标取「未被占用的那个交点」，
                // 名字仍然取 names[0]（调用方只给一个待用名时也成立）。
                const missing = findPoint0 ? intersectionPoints[1] : intersectionPoints[0];
                const missingName = names[0];
                // 该名字若已被占用（例如正好等于已存在点的名字），就不要重复建，避免覆盖。
                const occupant = this.state.objects.get(missingName);
                if (occupant instanceof Point && occupant.distanceTo2(missing.x, missing.y) <= this.zeroThresholdValue) {
                    return;
                }
                const intersectionPoint = new Point(missingName, missing.x, missing.y);
                this.state.objects.set(intersectionPoint.name, intersectionPoint);

                if (draw != null && draw == 'true' && this.state.ctx) {
                    this.collectDraw(params, intersectionPoint);
                }

                return;
            }

            // 两个交点都还没有命名，一次建两个。
            // 老脚本可能只给一个名字（`name=P`）就指望建两个交点：这时第二个名字退化成
            // `<名字>_2`，跟解释器里其它合成点的命名习惯一致，不至于丢一个点或撞名。
            const secondName = names[1] && names[1].length > 0 ? names[1] : `${names[0]}_2`;
            const intersectionPoint1 = new Point(names[0], intersectionPoints[0].x, intersectionPoints[0].y);
            const intersectionPoint2 = new Point(secondName, intersectionPoints[1].x, intersectionPoints[1].y);
            this.state.objects.set(intersectionPoint1.name, intersectionPoint1);
            this.state.objects.set(intersectionPoint2.name, intersectionPoint2);

            if (draw != null && draw == 'true' && this.state.ctx) {
                this.collectDraw(params, intersectionPoint1);
                this.collectDraw(params, intersectionPoint2);
            }

            return;
        }
    }

    private LineAndCircleIntersection(params: Map<string, string>, obj1Raw: LinearObject, obj2Raw: Circle, name: string, obj1Name: string, obj2Name: string): void {
        const points = obj2Raw.getIntersectionWithLine(obj1Raw);
        if (points.length === 0) {
            throw new Error(`No intersection found between ${obj1Name} and ${obj2Name}`);
        }

        const names = name.split(',');
        if (points.length === 1) {
            // 如果只有一个交点（直线与圆相切）
            // 相切点若已被命名过，就不要再建一次、也不要覆盖。
            const existing = this.findPoint(points[0].x, points[0].y);
            if (existing) {
                return;
            }
            const intersectionPoint = new Point(names[0], points[0].x, points[0].y);
            this.state.objects.set(intersectionPoint.name, intersectionPoint);

            const draw = params.get('draw');
            if (draw != null && draw == 'true' && this.state.ctx) {
                this.collectDraw(params, intersectionPoint);
            }

            return;
        }

        if (points.length === 2) {
            // 两个交点里可能已经有一个作为已命名点存在了，这时只补建「缺少的那个」。
            // 与 TwoCirclesIntersection 同样的规矩：绝不能用已存在点的名字去建另一个交点，
            // 那会把图上已有的点用新坐标覆盖掉。
            const findPoint0 = this.findPoint(points[0].x, points[0].y);
            const findPoint1 = this.findPoint(points[1].x, points[1].y);

            if (findPoint0 && findPoint1) {
                // 两个交点都已经命名了，不做处理
                return;
            }

            const draw = params.get('draw');

            if (findPoint0 || findPoint1) {
                const missing = findPoint0 ? points[1] : points[0];
                const missingName = names[0];
                const occupant = this.state.objects.get(missingName);
                if (occupant instanceof Point && occupant.distanceTo2(missing.x, missing.y) <= this.zeroThresholdValue) {
                    return;
                }
                const intersectionPoint = new Point(missingName, missing.x, missing.y);
                this.state.objects.set(intersectionPoint.name, intersectionPoint);

                if (draw != null && draw == 'true' && this.state.ctx) {
                    this.collectDraw(params, intersectionPoint);
                }
                return;
            }

            // 两个点都没有命名。名字给一个时第二个退化成 `<名字>_2`（与圆-圆求交一致）。
            const secondName = names[1] && names[1].length > 0 ? names[1] : `${names[0]}_2`;
            const intersectionPoint1 = new Point(names[0], points[0].x, points[0].y);
            const intersectionPoint2 = new Point(secondName, points[1].x, points[1].y);

            this.state.objects.set(intersectionPoint1.name, intersectionPoint1);
            this.state.objects.set(intersectionPoint2.name, intersectionPoint2);

            if (draw != null && draw == 'true' && this.state.ctx) {
                this.collectDraw(params, intersectionPoint1);
                this.collectDraw(params, intersectionPoint2);
            }
        }
    }

    private createIntersection(params: Map<string, string>): void {
        // 实现两个对象交点创建
        // HELP 里写的是 `name (或n, ...)`，但这里历史上只认 `name`，照文档写 `n=P`
        // 会直接报「requires name, obj1, and obj2 parameters」。和 createPerpendicularFoot
        // 当初踩的是同一个坑：文档写了别名、实现只认主名。
        const name = params.get('name') || params.get('n');

        const obj1Name = params.get('obj1') || params.get('o1');
        const obj2Name = params.get('obj2') || params.get('o2');

        if (!name || !obj1Name || !obj2Name) {
            throw new Error('INTERSECT command requires name, obj1, and obj2 parameters');
        }

        const obj1Raw = this.getObject(obj1Name);
        const obj2Raw = this.getObject(obj2Name);

        if (!obj1Raw || !obj2Raw) {
            throw new Error(`Objects ${obj1Name} or ${obj2Name} not found`);
        }

        // 两条直线
        if (obj1Raw instanceof LinearObject && obj2Raw instanceof LinearObject) {
            // 如果两个对象都是线性对象，则计算交点
            return this.TwoLinesIntersection(params, obj1Raw, obj2Raw, name, obj1Name, obj2Name);
        }

        // 两个圆
        if (obj1Raw instanceof Circle && obj2Raw instanceof Circle) {
            // 如果两个对象都是圆，则计算交点
            return this.TwoCirclesIntersection(params, obj1Raw, obj2Raw, name, obj1Name, obj2Name);
        }

        // 一条直线和一个圆
        if (obj1Raw instanceof LinearObject && obj2Raw instanceof Circle) {
            // 如果一个对象是线性对象，另一个是圆，则计算交点
            return this.LineAndCircleIntersection(params, obj1Raw, obj2Raw, name, obj1Name, obj2Name);
        }

        if (obj1Raw instanceof Circle && obj2Raw instanceof LinearObject) {
            // 如果一个对象是圆，另一个是线性对象，则计算交点
            return this.LineAndCircleIntersection(params, obj2Raw, obj1Raw, name, obj2Name, obj1Name);
        }

        // 一个角和一条直线
        if (obj1Raw instanceof Angle && obj2Raw instanceof LinearObject) {
            return this.TwoLinesIntersection(params, obj1Raw.line2!, obj2Raw, name, obj1Name, obj2Name);
        }
        if (obj1Raw instanceof LinearObject && obj2Raw instanceof Angle) {
            return this.TwoLinesIntersection(params, obj1Raw, obj2Raw.line2!, name, obj1Name, obj2Name);
        }

        // 一个角和一个圆
        if (obj1Raw instanceof Angle && obj2Raw instanceof Circle) {
            return this.LineAndCircleIntersection(params, obj1Raw.line2!, obj2Raw, name, obj1Name, obj2Name);
        }
        if (obj1Raw instanceof Circle && obj2Raw instanceof Angle) {
            return this.LineAndCircleIntersection(params, obj2Raw.line2!, obj1Raw, name, obj1Name, obj2Name);
        }

        // 两个角
        if (obj1Raw instanceof Angle && obj2Raw instanceof Angle) {
            return this.TwoLinesIntersection(params, obj1Raw.line2!, obj2Raw.line2!, name, obj1Name, obj2Name);
        }

    }

    private createPointOnLine(params: Map<string, string>): void {
        // 实现线上点创建
        const name = params.get('name');
        const lineName = params.get('line');
        const distance = this.getNumberValue(params, 'distance') || this.getNumberValue(params, 'd') || 0;
        const pointName = params.get('point') || params.get('p');

        if (!name || !lineName || !pointName || isNaN(distance)) {
            throw new Error('POINT_ON_LINE command requires name, line, and point parameters');
        }

        const lineRaw = this.getObject(lineName);
        const pointRaw = this.getObject(pointName);

        if (!lineRaw || !pointRaw) {
            throw new Error(`Line ${lineName} or point ${pointName} not found`);
        }

        if (!(lineRaw instanceof Line || lineRaw instanceof Segment || lineRaw instanceof Ray)) {
            throw new Error(`Object ${lineName} is not a valid linear object`);
        }

        const line = lineRaw as LinearObject;
        const point = pointRaw as Point;

        // 计算点在线段上的位置
        const newPointPos = line.pointAtDistance(point, distance);
        const newPoint = new Point(name, newPointPos.x, newPointPos.y);
        this.state.objects.set(name, newPoint);

        const draw = params.get('draw');
        if (draw != null && draw == 'true' && this.state.ctx) {
            this.collectDraw(params, newPoint);
        }
    }

    /**
     * 在圆周边上、以「圆心为原点、给定角度（度）」的位置创建一点。
     *
     * 与 POINT_ON_LINE 同理：点引用的是圆对象本身，每次脚本重跑都重新按
     * `center + radius·(cosθ, sinθ)` 算一遍，所以拖动圆（圆心或半径变化）时
     * 这个点会跟着圆走，不会脱钩。右键菜单里的「圆周边上离鼠标最近的点」
     * 就是拿这个命令 + 鼠标相对圆心的角度实现的。
     */
    private createPointOnCircle(params: Map<string, string>): void {
        const name = params.get('name');
        const circleName = params.get('circle') || params.get('c');
        const angleStr = params.get('angle') || params.get('a');

        if (!name || !circleName || angleStr == null) {
            throw new Error('POINT_ON_CIRCLE command requires name, circle, and angle parameters');
        }

        const circleRaw = this.getObject(circleName);
        if (!circleRaw || !(circleRaw instanceof Circle)) {
            throw new Error(`Circle ${circleName} not found`);
        }
        const circle = circleRaw as Circle;

        const angleDegrees = this.getNumberValue(params, 'angle') ?? this.getNumberValue(params, 'a');
        if (angleDegrees == null || isNaN(angleDegrees)) {
            throw new Error(`Invalid angle value: ${angleStr}`);
        }

        const angleRad = angleDegrees * (Math.PI / 180);
        const newX = circle.center.x + circle.radius * Math.cos(angleRad);
        const newY = circle.center.y + circle.radius * Math.sin(angleRad);
        const newPoint = new Point(name, newX, newY);
        this.state.objects.set(name, newPoint);

        const draw = params.get('draw');
        if (draw != null && draw == 'true' && this.state.ctx) {
            this.collectDraw(params, newPoint);
        }
    }

    /**
     * 创建圆的圆心点。
     *
     * 同样引用圆对象本身（每次重跑都从 `circle.center` 重新取坐标），
     * 所以圆心点会跟着圆一起移动。「选中一个圆 → 创建圆心」就是它。
     */
    private createCircleCenter(params: Map<string, string>): void {
        const name = params.get('name');
        const circleName = params.get('circle') || params.get('c');

        if (!name || !circleName) {
            throw new Error('CIRCLE_CENTER command requires name and circle parameters');
        }

        const circleRaw = this.getObject(circleName);
        if (!circleRaw || !(circleRaw instanceof Circle)) {
            throw new Error(`Circle ${circleName} not found`);
        }
        const circle = circleRaw as Circle;

        const centerPoint = new Point(name, circle.center.x, circle.center.y);
        this.state.objects.set(name, centerPoint);

        const draw = params.get('draw');
        if (draw != null && draw == 'true' && this.state.ctx) {
            this.collectDraw(params, centerPoint);
        }
    }

    private createPerpBisector(params: Map<string, string>): void {
        // 实现垂直平分线创建
        const name = params.get('name');
        const p1Name = params.get('p1');
        const p2Name = params.get('p2');
        if (!name || !p1Name || !p2Name) {
            throw new Error('PERP_BISECTOR command requires name, p1, and p2 parameters');
        }

        const p1Raw = this.getObject(p1Name);
        const p2Raw = this.getObject(p2Name);

        if (!p1Raw || !p2Raw) {
            throw new Error(`Points ${p1Name} or ${p2Name} not found`);
        }

        const p1 = p1Raw as Point;
        const p2 = p2Raw as Point;

        // 计算中点
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        const midpoint = new Point(name + '_<mid>', midX, midY);
        // 计算垂直平分线的斜率
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        let newPoint: Point;
        if (dx === 0) {
            newPoint = new Point(name + '_<dir>', midX + 1, midY); // 水平线            
        } else if (dy === 0) {
            newPoint = new Point(name + '_<dir>', midX, midY + 1); // 垂直线
        } else {
            let slope = -dx / dy; // 垂直斜率
            // 计算垂直平分线上的一个点
            newPoint = new Point(name + '_<dir>', midX + 1, midY + slope);
        }

        this.state.objects.set(midpoint.name, midpoint);
        this.state.objects.set(newPoint.name, newPoint);

        // 创建垂直平分线对象
        const perpBisector = new Line(name, midpoint, newPoint);
        // 派生线的两个定义点都是内部合成点（`name_<mid>` / `name_<dir>`），
        // 没法像 LINE 那样靠交换 p1/p2 来删某一侧，所以方向标记在这里是必需的。
        this.applyLinearCutPoints(params, perpBisector);
        this.state.objects.set(name, perpBisector);
        if (params.get('draw') === 'true' && this.state.ctx) {
            this.collectDraw(params, perpBisector);
        }
    }

    private createPerpendicular(params: Map<string, string>): void {
        // 实现垂线创建
        const name = params.get('name');
        const lineName = params.get('line');
        const pointName = params.get('point') || params.get('p');
        if (!name || !lineName || !pointName) {
            throw new Error('PERPENDICULAR command requires name, line, and point parameters');
        }
        const lineRaw = this.getObject(lineName);
        const pointRaw = this.getObject(pointName);
        if (!lineRaw || !pointRaw) {
            throw new Error(`Line ${lineName} or point ${pointName} not found`);
        }
        if (!(lineRaw instanceof Line || lineRaw instanceof Segment || lineRaw instanceof Ray)) {
            throw new Error(`Object ${lineName} is not a valid linear object`);
        }
        const line = lineRaw as LinearObject;
        const point = pointRaw as Point;

        // 计算垂线上的点
        const perpPointPos = line.perpendicularLineThroughPoint(point);
        const perpPoint = new Point(name + '_<pend>', perpPointPos.x, perpPointPos.y);

        this.state.objects.set(perpPoint.name, perpPoint);

        // 创建垂线
        const perpendicularLine = new Line(name, point, perpPoint);
        this.applyLinearCutPoints(params, perpendicularLine);
        this.state.objects.set(name, perpendicularLine);
        if (params.get('draw') === 'true' && this.state.ctx) {
            this.collectDraw(params, perpendicularLine);
        }
    }

    private createParallel(params: Map<string, string>): void {
        // 实现平行线创建
        const name = params.get('name');
        const lineName = params.get('line');
        const pointName = params.get('point') || params.get('p');

        if (!name || !lineName || !pointName) {
            throw new Error('PARALLEL command requires name, line, and point parameters');
        }
        const lineRaw = this.getObject(lineName);
        const pointRaw = this.getObject(pointName);
        if (!lineRaw || !pointRaw) {
            throw new Error(`Line ${lineName} or point ${pointName} not found`);
        }
        if (!(lineRaw instanceof Line || lineRaw instanceof Segment || lineRaw instanceof Ray)) {
            throw new Error(`Object ${lineName} is not a valid linear object`);
        }

        const line = lineRaw as LinearObject;
        const point = pointRaw as Point;

        // 计算平行线上的点
        const parallelPointPos = line.parallelLineThroughPoint(point);
        const parallelPoint = new Point(name + '_<para>', parallelPointPos.x, parallelPointPos.y);
        this.state.objects.set(parallelPoint.name, parallelPoint);

        // 创建平行线
        const parallelLine = new Line(name, point, parallelPoint);
        this.applyLinearCutPoints(params, parallelLine);
        this.state.objects.set(name, parallelLine);
        if (params.get('draw') === 'true' && this.state.ctx) {
            this.collectDraw(params, parallelLine);
        }
    }

    private createAngleBisector(params: Map<string, string>): void {
        // 实现角平分线创建
        const name = params.get('name');
        const angleName = params.get('angle') || params.get('a');

        if (!name || !angleName) {
            throw new Error('ANGLE_BISECTOR command requires name and angle parameters');
        }

        const angleRaw = this.getObject(angleName);
        if (!angleRaw || !(angleRaw instanceof Angle)) {
            throw new Error(`Angle ${angleName} not found or is not a valid angle object`);
        }

        const angle = angleRaw as Angle;
        // 计算角平分线上的点

        const bisectorPointPos = angle.getRotatedPoint1(angle.degreesValue / 2);
        const bisectorPoint = new Point(name + '_<bisector>', bisectorPointPos.x, bisectorPointPos.y);
        this.state.objects.set(bisectorPoint.name, bisectorPoint);

        // 创建角平分线
        const bisectorLine = new Line(name, angle.vertex, bisectorPoint);
        this.applyLinearCutPoints(params, bisectorLine);
        this.state.objects.set(name, bisectorLine);
        if (params.get('draw') === 'true' && this.state.ctx) {
            this.collectDraw(params, bisectorLine);
        }
    }

    private createCircumcircle(params: Map<string, string>): void {
        // 实现外接圆创建
        const name = params.get('name');
        const p1Name = params.get('p1');
        const p2Name = params.get('p2');
        const p3Name = params.get('p3');

        if (!name || !p1Name || !p2Name || !p3Name) {
            throw new Error('CIRCUMCIRCLE command requires name, p1, p2, and p3 parameters');
        }
        const p1 = this.getObject(p1Name);
        const p2 = this.getObject(p2Name);
        const p3 = this.getObject(p3Name);

        if (!p1 || !p2 || !p3) {
            throw new Error(`Points ${p1Name}, ${p2Name}, or ${p3Name} not found`);
        }

        // 这里需要创建实际的Circumcircle对象
        const circumcircle = Circle.fromCircumcircle(p1 as Point, p2 as Point, p3 as Point);
        const center = new Point(name + '_<cumcenter>', circumcircle.pt.x, circumcircle.pt.y);
        this.state.objects.set(center.name, center);
        const circle = Circle.fromRadius(name, center, circumcircle.radius);
        this.state.objects.set(name, circle);

        const draw = params.get('draw');
        if (draw != null && draw == 'true' && this.state.ctx) {
            this.collectDraw(params, circle);
        }
    }

    private createIncircle(params: Map<string, string>): void {
        // 实现内切圆创建
        const name = params.get('name');
        const p1Name = params.get('p1');
        const p2Name = params.get('p2');
        const p3Name = params.get('p3');

        if (!name || !p1Name || !p2Name || !p3Name) {
            throw new Error('CIRCUMCIRCLE command requires name, p1, p2, and p3 parameters');
        }
        const p1 = this.getObject(p1Name);
        const p2 = this.getObject(p2Name);
        const p3 = this.getObject(p3Name);

        if (!p1 || !p2 || !p3) {
            throw new Error(`Points ${p1Name}, ${p2Name}, or ${p3Name} not found`);
        }

        // 这里需要创建实际的Incircle对象
        const incircle = Circle.fromIncircle(p1 as Point, p2 as Point, p3 as Point);
        const center = new Point(name + '_<inccenter>', incircle.pt.x, incircle.pt.y);
        this.state.objects.set(center.name, center);
        const circle = Circle.fromRadius(name, center, incircle.radius);
        this.state.objects.set(name, circle);

        const draw = params.get('draw');
        if (draw != null && draw == 'true' && this.state.ctx) {
            this.collectDraw(params, circle);
        }
    }

    /**
     * 过一点作圆的切线。
     *
     * 名字约定（与 HELP / SystemPrompt 一致）：
     * - `name` 是**切点的名字**，逗号分隔。
     * - 圆外一点 → 两条切线、两个切点，`name=T1,T2`；切线名自动派生为 `T1_tan` / `T2_tan`。
     *   只给一个名字时第二个切点退化成 `<名字>_2`（和 INTERSECT 的合成命名习惯一致）。
     * - 圆上一点 → 只有一条切线、切点就是给定的那一点；切线名派生为 `<名字>_tan`。
     *
     * 以前这里有两处实打实的 bug：圆外分支里两条线段**都**连到 tangentPoint1（第二条
     * 切线其实是第一条的重复），而且 `splitName[1]` 被同时当成点名和线名用 —— 于是
     * 第二条线覆盖掉了第二个切点。现在切点和切线各自独立命名，两条切线各连各自的切点。
     */
    private createTangent(params: Map<string, string>): void {
        const name = params.get('name');
        const circleName = params.get('circle') || params.get('c');
        const pointName = params.get('point') || params.get('p');

        if (!name || !circleName || !pointName) {
            throw new Error('TANGENT command requires name, circle, and point parameters');
        }

        const circleRaw = this.getObject(circleName);
        const pointRaw = this.getObject(pointName);
        if (!circleRaw || !pointRaw) {
            throw new Error(`Circle ${circleName} or point ${pointName} not found`);
        }

        if (!(circleRaw instanceof Circle)) {
            throw new Error(`Object ${circleName} is not a valid circle object`);
        }
        if (!(pointRaw instanceof Point)) {
            throw new Error(`Object ${pointName} is not a valid point object`);
        }

        const circle = circleRaw as Circle;
        const point = pointRaw as Point;

        const names = name.split(',').map(item => item.trim()).filter(item => item.length > 0);
        if (names.length === 0) {
            throw new Error('TANGENT command requires at least one name');
        }

        const draw = params.get('draw');
        const shouldDraw = draw != null && draw == 'true' && this.state.ctx;
        // 切线始终跟着 draw 走；切点额外受 `showPoints` 控制（默认显示）。
        // 分开是因为「只画切线、不标切点」是常见诉求，而 `draw=false` 会把两者一起关掉。
        const shouldDrawPoints = shouldDraw && this.getBooleanParam(params, true, 'showPoints', 'sp');

        // 切点落在这个位置的话，用已有的点、不再新建一个（避免图上出现两个重合的点）。
        // 与 INTERSECT 系列同一套容差口径。
        const approxPoint = (a: Point, b: Point) =>
            a.distanceTo2(b.x, b.y) <= this.zeroThresholdValue;
        const reuseOrCreatePoint = (preferredName: string, x: number, y: number): Point => {
            const existing = this.findPoint(x, y);
            if (existing) return existing;
            const created = new Point(preferredName, x, y);
            this.state.objects.set(created.name, created);
            return created;
        };

        const distance = circle.center.distanceTo(point);

        // ---- 点在圆上：只有一条切线，过该点作 OP 的垂线即可。
        if (Math.abs(distance - circle.radius) <= this.zeroThresholdValue) {
            const contactName = names[0];
            // 切点就是给定的那个点。
            // 名字约定下 `point=P` + `name=T` 表示「切点叫 T」：若 T 还没被占用，
            // 就建一个与 P 重合的新点 T；若 T 已经是点（含 T===P 这种同一名字），
            // 就直接用——但要把它的坐标对齐到 P，避免脚本里给了错坐标时切点跑到别处。
            const existingContact = this.state.objects.get(contactName);
            let contact: Point;
            if (existingContact instanceof Point) {
                contact = existingContact;
                if (!(approxPoint(existingContact, point))) {
                    this.state.objects.delete(contactName);
                    contact = new Point(contactName, point.x, point.y);
                    this.state.objects.set(contactName, contact);
                }
            } else {
                contact = new Point(contactName, point.x, point.y);
                this.state.objects.set(contactName, contact);
            }

            // 过切点作半径的垂线：借 Segment 的垂线工具算一个方向点（不画这条辅助半径）。
            const radiusHelper = new Segment(`${names[0]}_<circle_radius>`, point, circle.center);
            const perpPos = radiusHelper.perpendicularLineThroughPoint(point);
            const perpPoint = new Point(`${names[0]}_<circle_Point>`, perpPos.x, perpPos.y);
            this.state.objects.set(perpPoint.name, perpPoint);

            const tangentLine = new Segment(`${names[0]}_tan`, contact, perpPoint);
            this.state.objects.set(tangentLine.name, tangentLine);

            if (shouldDraw) {
                if (shouldDrawPoints) this.collectDraw(params, contact);
                this.collectDraw(params, tangentLine);
            }
            return;
        }

        if (distance < circle.radius - this.zeroThresholdValue) {
            throw new Error(`Point ${pointName} is inside the circle ${circleName}, cannot create tangent`);
        }

        // ---- 点在圆外：两条切线、两个切点。
        // 切点 = 以「该点到圆心」为半径的辅助圆与已知圆的交点，所以用勾股定理先求切线长。
        const tangentLength = Math.sqrt(distance * distance - circle.radius * circle.radius);
        const tangentPointPositions = circle.getPointAtDistanceFromTarget(point, tangentLength);
        if (tangentPointPositions.length !== 2) {
            throw new Error(`Failed to calculate tangent points for ${pointName} on circle ${circleName}`);
        }

        // 第二个切点的名字：用户没给就用 `<名字>_2`，跟其它合成点一致。
        const secondContactName = names[1] && names[1].length > 0 ? names[1] : `${names[0]}_2`;

        // `getPointAtDistanceFromTarget` 内部走的是两圆求交，返回顺序取决于辅助圆的
        // 内部构造，和用户直觉的「上/下」无关。这里按相对圆心的角度排一下序：
        // 角度小的在前（即 y 小的在前，因为数学坐标 y 向上、atan2 在 y 越小时越小），
        // 这样 names[0] 稳定地对应「偏下」那个切点、names[1] 对应「偏上」那个，
        // 同一个脚本每次执行、以及和用户在图上看到的顺序都对得上。
        const sortedPositions = tangentPointPositions.slice().sort((a, b) => {
            const angleA = Math.atan2(a.y - circle.center.y, a.x - circle.center.x);
            const angleB = Math.atan2(b.y - circle.center.y, b.x - circle.center.x);
            return angleA - angleB;
        });

        const contacts = [
            { name: names[0], position: sortedPositions[0] },
            { name: secondContactName, position: sortedPositions[1] },
        ];

        for (const { name: contactName, position } of contacts) {
            const contact = reuseOrCreatePoint(contactName, position.x, position.y);
            // 每条切线连**自己的**切点；名字用 `<切点名>_tan` 派生，不和切点撞名。
            const tangentLineAlias = `${contact.name}_tan`;
            const tangentLine = new Segment(tangentLineAlias, point, contact);
            this.state.objects.set(tangentLine.name, tangentLine);

            if (shouldDraw) {
                if (shouldDrawPoints) this.collectDraw(params, contact);
                this.collectDraw(params, tangentLine);
            }
        }
    }

    private createPolygon(params: Map<string, string>): void {
        // 实现多边形创建
        const name = params.get('name');
        const pointsParam = params.get('points') || params.get('p');
        if (!name || !pointsParam) {
            throw new Error('POLYGON command requires name and points parameters');
        }

        const pointsNames = pointsParam.split(',');
        const points: Point[] = [];
        for (const pointName of pointsNames) {
            const point = this.getObject(pointName.trim());
            if (!point || !(point instanceof Point)) {
                throw new Error(`Point ${pointName} not found or is not a valid point object`);
            }
            points.push(point);
        }

        if (points.length < 3) {
            throw new Error('POLYGON command requires at least 3 points');
        }
        // 这里需要创建实际的Polygon对象
        const polygon = new Polygon(name, points);
        this.state.objects.set(name, polygon);

        const draw = params.get('draw');
        if (draw != null && draw == 'true' && this.state.ctx) {
            this.collectDraw(params, polygon);
        }
    }

    private getNumberParam(params: Map<string, string>, ...keys: string[]): number | undefined {
        for (const key of keys) {
            const value = this.getNumberValue(params, key);
            if (value !== undefined && Number.isFinite(value)) return value;
        }
        return undefined;
    }

    private getBooleanParam(params: Map<string, string>, defaultValue: boolean, ...keys: string[]): boolean {
        for (const key of keys) {
            const value = params.get(key);
            if (value !== undefined) return GeometryDSLInterpreter.parseBoolean(value);
        }
        return defaultValue;
    }

    private formatAxisNumber(value: number): string {
        const rounded = Math.abs(value) < 1e-10 ? 0 : Math.round(value * 1e6) / 1e6;
        return String(rounded);
    }

    private drawArrowhead(
        ctx: CanvasRenderingContext2D,
        transform: { scale: number; offsetX: number; offsetY: number },
        tip: IPoint,
        direction: 'right' | 'up' | 'left' | 'down',
        size: number,
    ): void {
        const half = size * 0.45;
        const wingA = direction === 'right'
            ? { x: tip.x - size, y: tip.y - half }
            : direction === 'left'
                ? { x: tip.x + size, y: tip.y - half }
                : direction === 'up'
                    ? { x: tip.x - half, y: tip.y - size }
                    : { x: tip.x - half, y: tip.y + size };
        const wingB = direction === 'right'
            ? { x: tip.x - size, y: tip.y + half }
            : direction === 'left'
                ? { x: tip.x + size, y: tip.y + half }
                : direction === 'up'
                    ? { x: tip.x + half, y: tip.y - size }
                    : { x: tip.x + half, y: tip.y + size };
        const screenTip = toScreenPoint(tip.x, tip.y, transform);
        const screenA = toScreenPoint(wingA.x, wingA.y, transform);
        const screenB = toScreenPoint(wingB.x, wingB.y, transform);
        ctx.beginPath();
        ctx.moveTo(screenTip.x, screenTip.y);
        ctx.lineTo(screenA.x, screenA.y);
        ctx.moveTo(screenTip.x, screenTip.y);
        ctx.lineTo(screenB.x, screenB.y);
        ctx.stroke();
    }

    // 当前可见区域对应的逻辑坐标范围。
    // Canvas 路径的 ctx 已预置 setTransform，可见区域是 canvasX/canvasY/width/height 这块「画布坐标」；
    // SVG 导出路径没有预置变换，可见区域就是整块 SVG 画布。两条路径都要能算对。
    private getVisibleLogicalBounds(): { minX: number; maxX: number; minY: number; maxY: number } | null {
        if (!this.state.canvas) return null;
        const transform = this.getTextRenderTransform();
        if (!(Math.abs(transform.scale) > this.zeroThresholdValue)) return null;

        const visible = this.getVisibleViewRect();
        if (!(visible.width > 0) || !(visible.height > 0)) return null;

        // 渲染坐标 -> 逻辑坐标（y 轴方向相反）。
        // 变换里可能带旋转（SVG 路径），所以四角都要算：只反算两个角会漏掉旋转后
        // 探出去的那部分，坐标轴 / 网格的范围在小画布上会不够宽。
        const corners = [
            fromScreenPoint(visible.x, visible.y, transform),
            fromScreenPoint(visible.x + visible.width, visible.y, transform),
            fromScreenPoint(visible.x, visible.y + visible.height, transform),
            fromScreenPoint(visible.x + visible.width, visible.y + visible.height, transform),
        ];
        return {
            minX: Math.min(...corners.map(corner => corner.x)),
            maxX: Math.max(...corners.map(corner => corner.x)),
            minY: Math.min(...corners.map(corner => corner.y)),
            maxY: Math.max(...corners.map(corner => corner.y)),
        };
    }

    // 把任意步长吸附到 1/2/5 × 10^n 这一系列「整数级」数值，让刻度落在好读的数上。
    private niceStep(rawStep: number): number {
        if (!(rawStep > 0) || !Number.isFinite(rawStep)) return 1;
        const exponent = Math.floor(Math.log10(rawStep));
        const base = Math.pow(10, exponent);
        const normalized = rawStep / base;
        const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
        return factor * base;
    }

    // AXIS / GRID 共用的「默认范围 + 默认步长」解析。
    //
    // 简化目标：`CREATE AXIS name=axes` / `CREATE GRID name=grid` 一个参数都不写也要好看。
    // 所以默认值这样取：
    // - 范围贴合当前可见区域（原来写死 origin±10，换个 scale 就整条跑到画布外）；
    // - 步长按 scale 自动选「整数级」数值，使刻度间距约 AXIS_TARGET_TICK_PIXELS 像素，
    //   数字既不会挤成一团也不会稀疏到没有意义；
    // - 范围向外吸附到步长的整数倍，保证网格线落在整数刻度上。
    // 任何显式给出的参数都优先，行为与以前一致。
    private resolveAxisRange(
        params: Map<string, string>,
        scale: number,
        originX: number,
        originY: number,
    ): { minX: number; maxX: number; minY: number; maxY: number; xStep: number; yStep: number } {
        const autoStep = this.niceStep(AXIS_TARGET_TICK_PIXELS / scale);
        const explicitXStep = this.getNumberParam(params, 'xStep', 'step');
        const explicitYStep = this.getNumberParam(params, 'yStep', 'step');
        const xStep = Math.abs(explicitXStep ?? autoStep);
        // 只给了 xStep 时让 yStep 跟着走，避免「方形网格」被拆成两套步长。
        const yStep = Math.abs(explicitYStep ?? explicitXStep ?? autoStep);

        const view = this.getVisibleLogicalBounds() ?? {
            minX: originX - AXIS_FALLBACK_HALF_SPAN,
            maxX: originX + AXIS_FALLBACK_HALF_SPAN,
            minY: originY - AXIS_FALLBACK_HALF_SPAN,
            maxY: originY + AXIS_FALLBACK_HALF_SPAN,
        };

        const snapFloor = (value: number, step: number) => Math.floor(value / step + 1e-9) * step;
        const snapCeil = (value: number, step: number) => Math.ceil(value / step - 1e-9) * step;

        return {
            minX: this.getNumberParam(params, 'xMin', 'xmin', 'minX') ?? snapFloor(view.minX, xStep),
            maxX: this.getNumberParam(params, 'xMax', 'xmax', 'maxX') ?? snapCeil(view.maxX, xStep),
            minY: this.getNumberParam(params, 'yMin', 'ymin', 'minY') ?? snapFloor(view.minY, yStep),
            maxY: this.getNumberParam(params, 'yMax', 'ymax', 'maxY') ?? snapCeil(view.maxY, yStep),
            xStep,
            yStep,
        };
    }

    private createAxis(params: Map<string, string>): void {
        if (!this.state.ctx || !this.state.canvas) return;
        const originX = this.getNumberParam(params, 'originX', 'ox') ?? 0;
        const originY = this.getNumberParam(params, 'originY', 'oy') ?? 0;
        const transform = this.getTextRenderTransform();
        const scale = Math.abs(transform.scale) > this.zeroThresholdValue ? Math.abs(transform.scale) : 1;
        const { minX, maxX, minY, maxY, xStep, yStep } = this.resolveAxisRange(params, scale, originX, originY);
        const tickSize = Math.abs(this.getNumberParam(params, 'tickSize', 'tick') ?? (AXIS_TICK_PIXELS / 2) / scale);
        const arrowSize = Math.abs(this.getNumberParam(params, 'arrowSize', 'arrow') ?? AXIS_ARROW_PIXELS / scale);
        const width = Math.max(0.1, this.getNumberParam(params, 'width', 'lineWidth') ?? 1);
        const fontSize = Math.max(1, this.getNumberParam(params, 'fontSize', 'fs') ?? 12);
        const color = this.parseColor(params, 'color') || '#666666';
        const labelColor = this.parseColor(params, 'labelColor') || color;
        const numbers = this.getBooleanParam(params, true, 'numbers', 'showNumbers');
        const arrows = this.getBooleanParam(params, true, 'arrows', 'showArrows');
        const bothArrows = this.getBooleanParam(params, false, 'bothArrows');
        const showOrigin = this.getBooleanParam(params, true, 'origin', 'showOrigin');
        const showLabels = this.getBooleanParam(params, true, 'labels', 'axisLabels', 'showLabels');
        const dashed = this.getBooleanParam(params, false, 'dashed', 'dash');
        const xLabel = params.get('xLabel') || params.get('xlabel') || 'x';
        const yLabel = params.get('yLabel') || params.get('ylabel') || 'y';
        const originLabel = params.get('originLabel') || params.get('olabel') || 'O';
        if (!(maxX > minX) || !(maxY > minY) || !(xStep > 0) || !(yStep > 0)) {
            throw new Error('AXIS requires maxX>minX, maxY>minY, and positive xStep/yStep');
        }

        const ctx = this.state.ctx;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = labelColor;
        ctx.lineWidth = width;
        ctx.setLineDash(dashed ? [4, 4] : []);
        if (originY >= minY && originY <= maxY) {
            const left = toScreenPoint(minX, originY, transform);
            const right = toScreenPoint(maxX, originY, transform);
            ctx.beginPath();
            ctx.moveTo(left.x, left.y);
            ctx.lineTo(right.x, right.y);
            ctx.stroke();
            if (arrows) this.drawArrowhead(ctx, transform, { x: maxX, y: originY }, 'right', arrowSize);
            if (arrows && bothArrows) this.drawArrowhead(ctx, transform, { x: minX, y: originY }, 'left', arrowSize);
        }
        if (originX >= minX && originX <= maxX) {
            const bottom = toScreenPoint(originX, minY, transform);
            const top = toScreenPoint(originX, maxY, transform);
            ctx.beginPath();
            ctx.moveTo(bottom.x, bottom.y);
            ctx.lineTo(top.x, top.y);
            ctx.stroke();
            if (arrows) this.drawArrowhead(ctx, transform, { x: originX, y: maxY }, 'up', arrowSize);
            if (arrows && bothArrows) this.drawArrowhead(ctx, transform, { x: originX, y: minY }, 'down', arrowSize);
        }

        ctx.setLineDash([]);
        if (numbers) {
            ctx.font = `${fontSize}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            if (originY >= minY && originY <= maxY) {
                const first = Math.ceil((minX - originX) / xStep - 1e-9);
                const last = Math.floor((maxX - originX) / xStep + 1e-9);
                for (let index = first; index <= last; index++) {
                    const value = originX + index * xStep;
                    if (Math.abs(value - originX) <= 1e-9) continue;
                    const tickA = toScreenPoint(value, originY - tickSize, transform);
                    const tickB = toScreenPoint(value, originY + tickSize, transform);
                    ctx.beginPath();
                    ctx.moveTo(tickA.x, tickA.y);
                    ctx.lineTo(tickB.x, tickB.y);
                    ctx.stroke();
                    const labelPoint = toScreenPoint(value, originY - tickSize * 2.2, transform);
                    // 刻度数字按「相对原点」的偏移标注，而不是绝对逻辑坐标。
                    // 这样把 originY 挪到 260 画第二个坐标系时，轴上的 0/1/2 仍然是该坐标系自己的刻度；
                    // origin 为默认 (0,0) 时两者完全等价。
                    ctx.fillText(this.formatAxisNumber(index * xStep), labelPoint.x, labelPoint.y);
                }
            }
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            if (originX >= minX && originX <= maxX) {
                const first = Math.ceil((minY - originY) / yStep - 1e-9);
                const last = Math.floor((maxY - originY) / yStep + 1e-9);
                for (let index = first; index <= last; index++) {
                    const value = originY + index * yStep;
                    if (Math.abs(value - originY) <= 1e-9) continue;
                    const tickA = toScreenPoint(originX - tickSize, value, transform);
                    const tickB = toScreenPoint(originX + tickSize, value, transform);
                    ctx.beginPath();
                    ctx.moveTo(tickA.x, tickA.y);
                    ctx.lineTo(tickB.x, tickB.y);
                    ctx.stroke();
                    const labelPoint = toScreenPoint(originX - tickSize * 2.2, value, transform);
                    // 同上：y 轴数字同样相对 originY 标注。
                    ctx.fillText(this.formatAxisNumber(index * yStep), labelPoint.x, labelPoint.y);
                }
            }
        }

        if (showOrigin && originX >= minX && originX <= maxX && originY >= minY && originY <= maxY) {
            const point = toScreenPoint(originX, originY, transform);
            ctx.fillStyle = labelColor;
            ctx.beginPath();
            ctx.arc(point.x, point.y, Math.max(1.5, tickSize * Math.abs(transform.scale) * 0.35), 0, Math.PI * 2);
            ctx.fill();
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(originLabel, point.x + tickSize * Math.abs(transform.scale), point.y + tickSize * Math.abs(transform.scale));
        }
        if (showLabels) {
            ctx.font = `${fontSize}px Arial`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            if (originY >= minY && originY <= maxY) {
                const point = toScreenPoint(maxX, originY, transform);
                ctx.fillText(xLabel, point.x + tickSize * Math.abs(transform.scale), point.y);
            }
            if (originX >= minX && originX <= maxX) {
                const point = toScreenPoint(originX, maxY, transform);
                ctx.fillText(yLabel, point.x + tickSize * Math.abs(transform.scale), point.y - tickSize * Math.abs(transform.scale));
            }
        }
        ctx.restore();
    }

    private createGrid(params: Map<string, string>): void {
        if (!this.state.ctx || !this.state.canvas) return;
        const transform = this.getTextRenderTransform();
        const scale = Math.abs(transform.scale) > this.zeroThresholdValue ? Math.abs(transform.scale) : 1;
        // 网格和坐标轴共用同一套「默认范围 + 默认步长」，两者不写范围时也会自动对齐。
        const { minX, maxX, minY, maxY, xStep, yStep } = this.resolveAxisRange(params, scale, 0, 0);
        const width = Math.max(0.1, this.getNumberParam(params, 'width', 'lineWidth') ?? 1);
        const fontSize = Math.max(1, this.getNumberParam(params, 'fontSize', 'fs') ?? 10);
        const color = this.parseColor(params, 'color') || '#e5e7eb';
        const labelColor = this.parseColor(params, 'labelColor') || color;
        const dashed = this.getBooleanParam(params, true, 'dashed', 'dash');
        const numbers = this.getBooleanParam(params, false, 'numbers', 'showNumbers');
        if (!(maxX > minX) || !(maxY > minY) || !(xStep > 0) || !(yStep > 0)) {
            throw new Error('GRID requires maxX>minX, maxY>minY, and positive xStep/yStep');
        }

        const ctx = this.state.ctx;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = labelColor;
        ctx.lineWidth = width;
        ctx.setLineDash(dashed ? [3, 3] : []);
        const firstX = Math.ceil(minX / xStep - 1e-9);
        const lastX = Math.floor(maxX / xStep + 1e-9);
        for (let index = firstX; index <= lastX; index++) {
            const x = index * xStep;
            const bottom = toScreenPoint(x, minY, transform);
            const top = toScreenPoint(x, maxY, transform);
            ctx.beginPath();
            ctx.moveTo(bottom.x, bottom.y);
            ctx.lineTo(top.x, top.y);
            ctx.stroke();
        }
        const firstY = Math.ceil(minY / yStep - 1e-9);
        const lastY = Math.floor(maxY / yStep + 1e-9);
        for (let index = firstY; index <= lastY; index++) {
            const y = index * yStep;
            const left = toScreenPoint(minX, y, transform);
            const right = toScreenPoint(maxX, y, transform);
            ctx.beginPath();
            ctx.moveTo(left.x, left.y);
            ctx.lineTo(right.x, right.y);
            ctx.stroke();
        }
        if (numbers) {
            ctx.setLineDash([]);
            ctx.font = `${fontSize}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            for (let index = firstX; index <= lastX; index++) {
                const x = index * xStep;
                const point = toScreenPoint(x, minY, transform);
                ctx.fillText(this.formatAxisNumber(x), point.x, point.y + fontSize * 0.3);
            }
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            for (let index = firstY; index <= lastY; index++) {
                const y = index * yStep;
                const point = toScreenPoint(minX, y, transform);
                ctx.fillText(this.formatAxisNumber(y), point.x - fontSize * 0.3, point.y);
            }
        }
        ctx.restore();
    }

    /**
     * 创建一个有序点集。
     *
     * 支持两种来源：
     * - points=A,B,C：引用已有点；
     * - curve=f start=1 end=-1 step=0.1：按曲线采样生成点集。
     * 点集只作为区域/路径的边界数据存在，不会污染对象列表。
     */
    private createPointSet(params: Map<string, string>): void {
        const name = params.get('name') || params.get('n');
        if (!name) throw new Error('POINTSET command requires name parameter');

        const pointsParam = params.get('points') || params.get('p');
        if (pointsParam) {
            const points: Point[] = [];
            for (const pointName of pointsParam.split(',').map(value => value.trim()).filter(Boolean)) {
                const point = this.getObject(pointName);
                if (!point || !(point instanceof Point)) {
                    throw new Error(`Point ${pointName} not found or is not a valid point object`);
                }
                points.push(point);
            }
            if (points.length < 2) throw new Error('POINTSET points form requires at least 2 points');
            this.state.pointSets.set(name, points);
            return;
        }

        const curveName = params.get('curve') || params.get('source') || params.get('obj');
        if (!curveName) {
            throw new Error('POINTSET command requires points=<A,B,...> or curve=<curve>');
        }
        const curve = this.getObject(curveName);
        if (!(curve instanceof Curve)) throw new Error(`Object ${curveName} is not a CURVE`);

        const defaultStart = curve.rangeStart;
        const defaultEnd = curve.rangeEnd;
        const start = this.getNumberValue(params, 'start') ?? this.getNumberValue(params, 'xstart') ?? defaultStart;
        const end = this.getNumberValue(params, 'end') ?? this.getNumberValue(params, 'xend') ?? defaultEnd;
        const rawStep = this.getNumberValue(params, 'step') ?? this.getNumberValue(params, 'dx');
        const direction = end >= start ? 1 : -1;
        const step = Math.abs(rawStep ?? curve.sampleStep ?? 0.1) * direction;
        if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(step) || Math.abs(step) <= 1e-12) {
            throw new Error('POINTSET curve form requires finite start, end, and non-zero step');
        }

        const sampleCount = Math.min(10000, Math.max(1, Math.floor(Math.abs((end - start) / step))));
        const points: Point[] = [];
        for (let index = 0; index <= sampleCount; index++) {
            const x = index === sampleCount ? end : start + step * index;
            if (direction > 0 && x > end + 1e-10) break;
            if (direction < 0 && x < end - 1e-10) break;
            points.push(new Point(`${name}_<${points.length}>`, x, curve.evaluate(x)));
        }
        if (points.length < 2) throw new Error('POINTSET curve form produced fewer than 2 points');
        this.state.pointSets.set(name, points);
    }

    /**
     * 创建一个由有序点边界围成的可填充区域。
     *
     * 算法约定：boundary/points 中的点按边界行走顺序提供，最后一个点会
     * 自动与第一个点闭合；因此每条边都是确定的直线段，区域描述不会依赖
     * Canvas 当前缩放或像素采样。
     */
    private createRegion(params: Map<string, string>): void {
        const name = params.get('name');
        if (!name) {
            throw new Error('REGION command requires name parameter');
        }

        const circleName = params.get('circle') || params.get('c');
        const lineName = params.get('line') || params.get('l');
        const curveName = params.get('curve') || params.get('curve1');
        if (curveName || params.has('curve1')) {
            if (!circleName || !curveName) {
                throw new Error('REGION curve-circle form requires both curve and circle parameters');
            }
            const side = (params.get('side') || params.get('s') || '').trim().toLowerCase();
            if (side !== 'above' && side !== 'below') {
                throw new Error('REGION curve-circle form requires side=above or side=below');
            }
            const region = this.createCurveCircleRegion(name, curveName, circleName, side);
            this.state.objects.set(name, region);

            const draw = params.get('draw');
            if (draw === 'true' && this.state.ctx) {
                this.collectDraw(params, region);
            }
            return;
        }
        if (circleName || lineName) {
            if (!circleName || !lineName) {
                throw new Error('REGION circle-line form requires both circle and line parameters');
            }
            const side = (params.get('side') || params.get('s') || '').trim().toLowerCase();
            if (side !== 'left' && side !== 'right') {
                throw new Error('REGION circle-line form requires side=left or side=right');
            }
            const region = this.createCircularRegion(name, circleName, lineName, side);
            this.state.objects.set(name, region);

            const draw = params.get('draw');
            if (draw === 'true' && this.state.ctx) {
                this.collectDraw(params, region);
            }
            return;
        }

        const pointSetsParam = params.get('pointSets') || params.get('pointsets') || params.get('sets') || params.get('set');
        if (pointSetsParam) {
            const points: Point[] = [];
            for (const setName of pointSetsParam.split(',').map(value => value.trim()).filter(Boolean)) {
                const pointSet = this.state.pointSets.get(setName);
                if (!pointSet) {
                    throw new Error(`POINTSET ${setName} not found`);
                }
                for (const point of pointSet) {
                    const previous = points[points.length - 1];
                    if (previous && Math.abs(previous.x - point.x) <= 1e-9 && Math.abs(previous.y - point.y) <= 1e-9) continue;
                    points.push(point);
                }
            }
            // 多个点集通常首尾各自包含同一个交界点；去掉首尾重复点，
            // 因为 Region 会自动闭合，保留它会生成零长度的闭合边。
            if (points.length > 1) {
                const first = points[0];
                const last = points[points.length - 1];
                if (Math.abs(first.x - last.x) <= 1e-9 && Math.abs(first.y - last.y) <= 1e-9) {
                    points.pop();
                }
            }
            if (points.length < 3) {
                throw new Error('REGION pointSets form requires at least 3 combined points');
            }
            this.validateSimpleRegionBoundary(name, points);
            const region = new Region(name, points);
            this.state.objects.set(name, region);
            const draw = params.get('draw');
            if (draw === 'true' && this.state.ctx) {
                this.collectDraw(params, region);
            }
            return;
        }

        const pointsParam = params.get('boundary') || params.get('points') || params.get('p');
        if (!pointsParam) {
            throw new Error('REGION command requires boundary, pointSets, circle + line + side, or curve + circle + side parameters');
        }

        const pointNames = pointsParam.split(',').map(value => value.trim()).filter(Boolean);
        // 允许用户显式写回首点，但内部只保留一份首点，统一由 Polygon.closePath 闭合。
        if (pointNames.length > 1 && pointNames[0] === pointNames[pointNames.length - 1]) {
            pointNames.pop();
        }
        if (pointNames.length < 3) {
            throw new Error('REGION command requires at least 3 boundary points');
        }

        const points: Point[] = [];
        for (const pointName of pointNames) {
            const point = this.getObject(pointName);
            if (!point || !(point instanceof Point)) {
                throw new Error(`Point ${pointName} not found or is not a valid point object`);
            }
            points.push(point);
        }

        this.validateSimpleRegionBoundary(name, points);
        const region = new Region(name, points);
        this.state.objects.set(name, region);

        const draw = params.get('draw');
        if (draw === 'true' && this.state.ctx) {
            this.collectDraw(params, region);
        }
    }

    /**
     * 创建由 y=f(x) 曲线和圆弧围成的区域。
     * side=above/below 按圆弧中点相对曲线的 y 值选择边界，要求恰有两个交点。
     */
    private createCurveCircleRegion(name: string, curveName: string, circleName: string, side: 'above' | 'below'): CurveCircleRegion {
        const curve = this.getObject(curveName);
        if (!(curve instanceof Curve)) {
            throw new Error(`Object ${curveName} is not a function curve`);
        }

        const circle = this.getObject(circleName);
        if (!(circle instanceof Circle)) {
            throw new Error(`Object ${circleName} is not a circle`);
        }

        const rangeStart = Math.min(curve.rangeStart, curve.rangeEnd);
        const rangeEnd = Math.max(curve.rangeStart, curve.rangeEnd);
        const range = rangeEnd - rangeStart;
        if (!Number.isFinite(range) || range <= 1e-9) {
            throw new Error(`CURVE ${curveName} must have a non-zero x range`);
        }

        const circleEquation = (x: number): number => {
            const y = curve.evaluate(x);
            return (x - circle.center.x) * (x - circle.center.x)
                + (y - circle.center.y) * (y - circle.center.y)
                - circle.radius * circle.radius;
        };

        const sampleCount = Math.min(10000, Math.max(512, Math.ceil(range / Math.max(Math.abs(curve.sampleStep), 0.01))));
        const sampleStep = range / sampleCount;
        const roots: number[] = [];
        const rootEpsilon = 1e-8 * Math.max(1, circle.radius * circle.radius);
        const addRoot = (x: number): void => {
            if (!Number.isFinite(x)) return;
            if (!roots.some(existing => Math.abs(existing - x) <= Math.max(1e-7, sampleStep * 1e-3))) {
                roots.push(x);
            }
        };

        let previousX = rangeStart;
        let previousValue = circleEquation(previousX);
        if (Math.abs(previousValue) <= rootEpsilon) addRoot(previousX);

        for (let index = 1; index <= sampleCount; index++) {
            const currentX = index === sampleCount ? rangeEnd : rangeStart + index * sampleStep;
            const currentValue = circleEquation(currentX);
            if (Math.abs(currentValue) <= rootEpsilon) addRoot(currentX);

            if ((previousValue < 0 && currentValue > 0) || (previousValue > 0 && currentValue < 0)) {
                let left = previousX;
                let right = currentX;
                let leftValue = previousValue;
                for (let iteration = 0; iteration < 60; iteration++) {
                    const middle = (left + right) / 2;
                    const middleValue = circleEquation(middle);
                    if (Math.abs(middleValue) <= rootEpsilon) {
                        left = middle;
                        right = middle;
                        break;
                    }
                    if ((leftValue < 0 && middleValue > 0) || (leftValue > 0 && middleValue < 0)) {
                        right = middle;
                    } else {
                        left = middle;
                        leftValue = middleValue;
                    }
                }
                addRoot((left + right) / 2);
            }

            previousX = currentX;
            previousValue = currentValue;
        }

        roots.sort((a, b) => a - b);
        if (roots.length < 2) {
            throw new Error(`REGION ${name} cannot be created: CURVE ${curveName} and CIRCLE ${circleName} do not have two intersections in the curve range`);
        }
        if (roots.length > 2) {
            throw new Error(`REGION ${name} is ambiguous: CURVE ${curveName} and CIRCLE ${circleName} have ${roots.length} intersections; exactly two are required`);
        }

        const leftX = roots[0];
        const rightX = roots[1];
        const leftPoint = { x: leftX, y: curve.evaluate(leftX) };
        const rightPoint = { x: rightX, y: curve.evaluate(rightX) };
        const curveSampleCount = Math.min(4096, Math.max(16, Math.ceil((rightX - leftX) / Math.max(Math.abs(curve.sampleStep), 0.01))));
        const curvePoints: IPoint[] = [];
        for (let index = 0; index <= curveSampleCount; index++) {
            const x = leftX + (rightX - leftX) * index / curveSampleCount;
            curvePoints.push({ x, y: curve.evaluate(x) });
        }
        curvePoints[0] = leftPoint;
        curvePoints[curvePoints.length - 1] = rightPoint;

        const screenAngle = (point: IPoint): number =>
            Math.atan2(-(point.y - circle.center.y), point.x - circle.center.x);
        const arcStartAngle = screenAngle(rightPoint);
        const arcEndAngle = screenAngle(leftPoint);
        const twoPi = Math.PI * 2;
        const normalizedDelta = (from: number, to: number, counterclockwise: boolean): number => {
            let delta = to - from;
            if (counterclockwise) {
                while (delta > 0) delta -= twoPi;
                while (delta < -twoPi) delta += twoPi;
            } else {
                while (delta < 0) delta += twoPi;
                while (delta > twoPi) delta -= twoPi;
            }
            return delta;
        };
        const candidateIsOnRequestedSide = (counterclockwise: boolean): boolean => {
            const delta = normalizedDelta(arcStartAngle, arcEndAngle, counterclockwise);
            const middleAngle = arcStartAngle + delta / 2;
            const middlePoint = {
                x: circle.center.x + circle.radius * Math.cos(middleAngle),
                y: circle.center.y - circle.radius * Math.sin(middleAngle),
            };
            const curveY = curve.evaluate(Math.min(rightX, Math.max(leftX, middlePoint.x)));
            const difference = middlePoint.y - curveY;
            const epsilon = 1e-8 * Math.max(1, circle.radius);
            return side === 'above' ? difference > epsilon : difference < -epsilon;
        };

        const counterclockwise = candidateIsOnRequestedSide(true)
            ? true
            : candidateIsOnRequestedSide(false)
                ? false
                : (() => {
                    throw new Error(`REGION ${name} could not determine the ${side} circle arc`);
                })();

        return new CurveCircleRegion(
            name,
            curve,
            circle,
            curvePoints,
            arcStartAngle,
            arcEndAngle,
            counterclockwise,
            side,
        );
    }

    /**
     * 创建由圆弧和弦线围成的圆弓形区域。
     * side 按 line.p1 -> line.p2 的方向判断：left 为有向直线左侧，right 为右侧。
     */
    private createCircularRegion(name: string, circleName: string, lineName: string, side: 'left' | 'right'): CircularRegion {
        const circle = this.getObject(circleName);
        if (!(circle instanceof Circle)) {
            throw new Error(`Object ${circleName} is not a circle`);
        }

        const line = this.getObject(lineName);
        if (!(line instanceof Line)) {
            throw new Error(`Object ${lineName} is not a LINE; circle-line REGION requires a LINE object`);
        }

        const dx = line.p2.x - line.p1.x;
        const dy = line.p2.y - line.p1.y;
        const directionLengthSquared = dx * dx + dy * dy;
        if (directionLengthSquared <= 1e-18) {
            throw new Error(`LINE ${lineName} has coincident defining points and cannot cut a circle`);
        }

        const intersections = circle.getIntersectionWithLine(line);
        if (intersections.length < 2) {
            if (intersections.length === 1) {
                throw new Error(`REGION ${name} cannot be created: LINE ${lineName} is tangent to CIRCLE ${circleName}, so it does not enclose an area`);
            }
            throw new Error(`REGION ${name} cannot be created: LINE ${lineName} does not intersect CIRCLE ${circleName}`);
        }

        // 按有向直线上的参数排序，保证弦段从 line.p1 一侧走到 line.p2 一侧。
        const ordered = intersections
            .slice(0, 2)
            .sort((a, b) => {
                const ta = ((a.x - line.p1.x) * dx + (a.y - line.p1.y) * dy) / directionLengthSquared;
                const tb = ((b.x - line.p1.x) * dx + (b.y - line.p1.y) * dy) / directionLengthSquared;
                return ta - tb;
            });
        const startPoint = ordered[0];
        const endPoint = ordered[1];
        const center = circle.center;
        const radius = circle.radius;

        // 几何对象最终写入的是 Canvas 坐标，因此角度中的 y 轴需要翻转。
        const screenAngle = (point: IPoint): number =>
            Math.atan2(-(point.y - center.y), point.x - center.x);
        const arcStartAngle = screenAngle(endPoint);
        const arcEndAngle = screenAngle(startPoint);
        const twoPi = Math.PI * 2;

        const normalizedDelta = (from: number, to: number, counterclockwise: boolean): number => {
            let delta = to - from;
            if (counterclockwise) {
                while (delta > 0) delta -= twoPi;
                while (delta < -twoPi) delta += twoPi;
            } else {
                while (delta < 0) delta += twoPi;
                while (delta > twoPi) delta -= twoPi;
            }
            return delta;
        };

        const candidateIsOnRequestedSide = (counterclockwise: boolean): boolean => {
            const delta = normalizedDelta(arcStartAngle, arcEndAngle, counterclockwise);
            const middleAngle = arcStartAngle + delta / 2;
            const middlePoint = {
                x: center.x + radius * Math.cos(middleAngle),
                y: center.y - radius * Math.sin(middleAngle),
            };
            const sideCross = dx * (middlePoint.y - line.p1.y) - dy * (middlePoint.x - line.p1.x);
            const epsilon = 1e-8 * Math.max(1, radius * Math.sqrt(directionLengthSquared));
            return side === 'left' ? sideCross > epsilon : sideCross < -epsilon;
        };

        const counterclockwise = candidateIsOnRequestedSide(true)
            ? true
            : candidateIsOnRequestedSide(false)
                ? false
                : (() => {
                    throw new Error(`REGION ${name} could not determine the ${side} arc of CIRCLE ${circleName}`);
                })();

        return new CircularRegion(
            name,
            circle,
            line,
            startPoint,
            endPoint,
            arcStartAngle,
            arcEndAngle,
            counterclockwise,
            side,
        );
    }

    // 区域填充使用简单多边形的非零填充规则；自交边界会造成歧义，因此提前拒绝。
    private validateSimpleRegionBoundary(name: string, points: Point[]): void {
        const epsilon = 1e-9;
        const samePoint = (a: Point, b: Point): boolean =>
            Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon;
        const cross = (a: Point, b: Point, c: Point): number =>
            (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        const onSegment = (a: Point, b: Point, p: Point): boolean =>
            Math.min(a.x, b.x) - epsilon <= p.x && p.x <= Math.max(a.x, b.x) + epsilon
            && Math.min(a.y, b.y) - epsilon <= p.y && p.y <= Math.max(a.y, b.y) + epsilon;
        const intersects = (a: Point, b: Point, c: Point, d: Point): boolean => {
            const abC = cross(a, b, c);
            const abD = cross(a, b, d);
            const cdA = cross(c, d, a);
            const cdB = cross(c, d, b);

            if (((abC > epsilon && abD < -epsilon) || (abC < -epsilon && abD > epsilon))
                && ((cdA > epsilon && cdB < -epsilon) || (cdA < -epsilon && cdB > epsilon))) {
                return true;
            }
            return (Math.abs(abC) <= epsilon && onSegment(a, b, c))
                || (Math.abs(abD) <= epsilon && onSegment(a, b, d))
                || (Math.abs(cdA) <= epsilon && onSegment(c, d, a))
                || (Math.abs(cdB) <= epsilon && onSegment(c, d, b));
        };

        for (let i = 0; i < points.length; i++) {
            if (samePoint(points[i], points[(i + 1) % points.length])) {
                throw new Error(`REGION ${name} has two consecutive boundary points at the same position`);
            }
        }

        for (let i = 0; i < points.length; i++) {
            const a = points[i];
            const b = points[(i + 1) % points.length];
            for (let j = i + 1; j < points.length; j++) {
                // 相邻边共享端点是合法的，不算自交。
                const adjacent = j === i + 1 || (i === 0 && j === points.length - 1);
                if (adjacent) continue;
                const c = points[j];
                const d = points[(j + 1) % points.length];
                if (intersects(a, b, c, d)) {
                    throw new Error(`REGION ${name} boundary self-intersects between edges ${i + 1} and ${j + 1}`);
                }
            }
        }
    }

    private createTriangle(params: Map<string, string>): void {
        const name = params.get('name');
        const p1Name = params.get('p1');
        const p2Name = params.get('p2');
        const p3Name = params.get('p3');

        if (!name || !p1Name || !p2Name || !p3Name) {
            throw new Error('TRIANGLE command requires name, p1, p2, and p3 parameters');
        }

        const p1 = this.getObject(p1Name);
        const p2 = this.getObject(p2Name);
        const p3 = this.getObject(p3Name);

        if (!p1 || !p2 || !p3) {
            throw new Error(`Points ${p1Name}, ${p2Name}, or ${p3Name} not found`);
        }

        // 这里需要创建实际的Triangle对象
        const triangle = new Triangle(name, p1 as Point, p2 as Point, p3 as Point);
        this.state.objects.set(name, triangle);

        const draw = params.get('draw');
        if (draw != null && draw == 'true' && this.state.ctx) {
            this.collectDraw(params, triangle);
        }
    }

    private createRectangle(params: Map<string, string>): void {
        // 实现矩形创建
        const name = params.get('name');
        const p1Name = params.get('p1');
        const width = this.getNumberValue(params, 'width') || this.getNumberValue(params, 'w') || 0;
        const height = this.getNumberValue(params, 'height') || this.getNumberValue(params, 'h') || 0;

        if (!name || !p1Name || !width || !height) {
            throw new Error('RECTANGLE command requires name, p1, width, and height parameters');
        }

        const p1 = this.getObject(p1Name);
        if (!p1 || !(p1 instanceof Point)) {
            throw new Error(`Point ${p1Name} not found or is not a valid point object`);
        }

        // 这里需要创建实际的Rectangle对象
        const rectangle = Rectangle.fromWidthHeight(name, p1 as Point, width, height);
        this.state.objects.set(name, rectangle);

        const draw = params.get('draw');
        if (draw != null && draw == 'true' && this.state.ctx) {
            this.collectDraw(params, rectangle);
        }
    }

    private createCircle(params: Map<string, string>): void {
        const name = params.get('name');

        if (!name) {
            throw new Error('CIRCLE command requires name parameters');
        }

        // 第一种创建方式，采用圆心和半径创建
        const centerName = params.get('center') || params.get('c');
        const radius = this.getNumberValue(params, 'radius') || this.getNumberValue(params, 'r') || 0;

        if (centerName && radius) {
            const center = this.getObject(centerName);
            if (!center || !(center instanceof Point)) {
                throw new Error(`Center point ${centerName} not found`);
            }

            // 这里需要创建实际的Circle对象
            const circle = Circle.fromRadius(name, center as Point, radius);
            this.state.objects.set(name, circle);

            const draw = params.get('draw');
            if (draw != null && draw == 'true' && this.state.ctx) {
                this.collectDraw(params, circle);
            }

            return;
        }

        // 第二种创建方式，采用圆心和一条线
        const chordName = params.get('chord');
        if (centerName && chordName) {
            const center = this.getObject(centerName);
            const chord = this.getObject(chordName);
            if (!chord || !(chord instanceof Segment) || !center || !(center instanceof Point)) {
                throw new Error(`chord is is invalid`);
            }

            const circle = Circle.fromChord(name, center, chord.p1, chord.p2);
            this.state.objects.set(name, circle);

            const draw = params.get('draw');
            if (draw != null && draw == 'true' && this.state.ctx) {
                this.collectDraw(params, circle);
            }

            return;
        }

        // 第三种方式，和第二种方式一样，只不过采用弦的两个端点
        const chordPt1Name = params.get('chordPt1');
        const chordPt2Name = params.get('chordPt2');

        if (centerName && chordPt1Name && chordPt2Name) {
            const center = this.getObject(centerName);
            const chordPt1 = this.getObject(chordPt1Name);
            const chordPt2 = this.getObject(chordPt2Name);

            if (!center || !(center instanceof Point) || !chordPt1 || !(chordPt1 instanceof Point) || !(chordPt2) || !(chordPt2 instanceof Point)) {
                throw new Error('create circle need center chordPt1 chordPt2');
            }

            const circle = Circle.fromChord(name, center, chordPt1, chordPt2);
            this.state.objects.set(name, circle);

            const draw = params.get('draw');
            if (draw != null && draw == 'true' && this.state.ctx) {
                this.collectDraw(params, circle);
            }

            return;
        }

        // 第四种方式，通过一条弦和一个圆心角（如果知道圆周角，只需乘以2），这里可以创建2个圆，因此需要提供两个name参数
        const centerAngleName = params.get('centerAngle');
        if (chordName && centerAngleName) {
            const chord = this.getObject(chordName);
            const centerAngle = this.getNumberValue(params, centerAngleName);

            if (!chord || !(chord instanceof LinearObject) || !centerAngle) {
                throw new Error('create circle need chord centerAngle paramters')
            }

            const names = name.split(',');
            if (names.length == 1) {
                names.push(name + '_<next_circle>');
            }

            this.createCircleByCenterAngleAndChord(params, names[0], names[1], chord.p1, chord.p2, centerAngle);

            return;
        }

        // 第五种方式，通过一条弦的两个端点和一个圆心角
        if (chordPt1Name && chordPt2Name && centerAngleName) {
            const chordPt1 = this.getObject(chordPt1Name);
            const chordPt2 = this.getObject(chordPt2Name);
            const centerAngle = this.getNumberValue(params, centerAngleName);

            if (!centerAngle || !chordPt1 || !(chordPt1 instanceof Point) || !(chordPt2) || !(chordPt2 instanceof Point)) {
                throw new Error('create circle need centerAngle chordPt1 chordPt2');
            }

            const names = name.split(',');
            if (names.length == 1) {
                names.push(name + '_<next_circle>');
            }

            this.createCircleByCenterAngleAndChord(params, names[0], names[1], chordPt1, chordPt2, centerAngle);

            return;
        }

        // console.log(`Created circle ${name} with center ${centerName} and radius ${radius}`);
    }

    private createCircleByCenterAngleAndChord(params: Map<string, string>, name_1: string, name_2: string, chordPt1: Point, chordPt2: Point, centerAngle: number): { c1: Circle, c2: Circle } {
        const midPoint = new PointNativeObject(
            (chordPt1.x + chordPt2.x) / 2,
            (chordPt1.y + chordPt2.y) / 2
        );

        const halfAngle = centerAngle / 2;

        const chordLength = chordPt1.distanceTo(chordPt2);

        if (GeometricObject.isZero(Math.cos(halfAngle))) {
            // 弦是直径
            const circleCenter = new Point(name_1 + '<_circle_center>', midPoint.x, midPoint.y);
            const circle = Circle.fromRadius(name_1, circleCenter, chordLength / 2);

            this.state.objects.set(circle.name, circle);

            return { c1: circle, c2: circle };
        }

        // 处理异常情况：圆心角为 0 或 2π 的倍数
        if (GeometricObject.isZero(Math.sin(halfAngle))) {
            throw new Error("Angle cannot be 0 or a multiple of 2π, as this would imply an infinite radius for a non-zero chord.");
        }

        // 2. 使用半角公式计算半径
        // 在由半径(斜边)、半弦长和圆心到弦的距离(h)构成的直角三角形中，
        // sin(halfAngle) = (chord.length / 2) / radius
        const halfChordLength = chordLength / 2;
        const radius = halfChordLength / Math.sin(halfAngle);

        // 3. 计算圆心到弦中点的距离 h
        // cos(halfAngle) = h / radius  =>  h = radius * cos(halfAngle)
        // 或者使用 tan: tan(halfAngle) = halfChordLength / h => h = halfChordLength / tan(halfAngle)
        const h = halfChordLength / Math.tan(halfAngle);

        // 4. 计算从弦的一个端点到另一个端点的向量
        const dx = chordPt2.x - chordPt1.x;
        const dy = chordPt2.y - chordPt1.y;

        // 5. 计算一个垂直于弦的向量。如果弦向量是 (dx, dy)，则垂直向量是 (-dy, dx)。
        // 这个垂直向量的长度恰好也等于弦长 `chord.length`。
        // 我们需要将其缩放，使其长度等于 h。
        // 缩放因子 = h / chord.length
        const scale = h / chordLength;
        const offsetX = -dy * scale;
        const offsetY = dx * scale;

        // 6. 计算两个可能的圆心
        // 从中点分别加上和减去这个偏移向量
        const center1 = new Point(
            name_1 + '_<circle_center>',
            midPoint.x + offsetX,
            midPoint.y + offsetY
        );
        const center2 = new Point(
            name_2 + '_<circle_center>',
            midPoint.x - offsetX,
            midPoint.y - offsetY
        );

        this.state.objects.set(center1.name, center1);
        this.state.objects.set(center2.name, center2);

        // 7. 创建两个圆并返回
        const c1 = Circle.fromRadius(name_1, center1, radius);
        const c2 = Circle.fromRadius(name_2, center2, radius);

        this.state.objects.set(c1.name, c1);
        this.state.objects.set(c2.name, c2);

        const draw = params.get('draw');
        if (draw != null && draw == 'true' && this.state.ctx) {
            this.collectDraw(params, c1);
            this.collectDraw(params, c2);
        }

        return { c1, c2 };
    }

    private createEllipse(params: Map<string, string>): void {
        // 实现椭圆创建
        const name = params.get('name');
        const centerName = params.get('center') || params.get('c');
        const radiusX = this.getNumberValue(params, 'radiusX') || this.getNumberValue(params, 'rX') || 0;
        const radiusY = this.getNumberValue(params, 'radiusY') || this.getNumberValue(params, 'rY') || 0;
        const rotation = this.getNumberValue(params, 'rotation') || this.getNumberValue(params, 'rot') || 0;
        if (!name || !centerName || !radiusX || !radiusY) {
            throw new Error('ELLIPSE command requires name and center, radiusX, radiusY parameters');
        }

        const center = this.getObject(centerName);
        if (!center) {
            throw new Error(`Center point ${centerName} not found`);
        }
        // 这里需要创建实际的Ellipse对象
        const ellipse = new Ellipse(name, center as Point, radiusX, radiusY, rotation);
        this.state.objects.set(name, ellipse);

        const draw = params.get('draw');
        if (draw != null && draw == 'true' && this.state.ctx) {
            this.collectDraw(params, ellipse);
        }
    }

    private createParabola(params: Map<string, string>): void {
        const name = params.get('name') || params.get('n');
        if (!name) {
            throw new Error('Parabola command requires a "name" parameter.');
        }

        // --- 模式一：几何定义法 (vertex, pValue, rotateAngle) ---
        const vertexName = params.get('vertex') || params.get('v');
        const pValueStr = params.get('pValue') || params.get('p');
        const rotateAngleStr = params.get('rotateAngle') || params.get('rot') || '0';

        if (vertexName && pValueStr && rotateAngleStr) {
            const vertex = this.getObject(vertexName);
            if (!vertex || !(vertex instanceof Point)) {
                throw new Error(`Invalid vertex name for parabola: ${vertexName}`);
            }

            const pValue = this.getNumberValue(params, 'pValue') || this.getNumberValue(params, 'p');
            const rotateAngle = this.getNumberValue(params, 'rotateAngle') || this.getNumberValue(params, 'rot') || 0;

            if (pValue == null || isNaN(pValue) || rotateAngle == null || isNaN(rotateAngle)) {
                throw new Error('Invalid pValue or rotateAngle. They must be numbers.');
            }

            const parabola = new Parabola(name, vertex, pValue, rotateAngle);
            this.state.objects.set(name, parabola);

            const draw = params.get('draw');
            if (draw != null && draw == 'true' && this.state.ctx) {
                this.collectDraw(params, parabola);
            }

            return;
        }

        // --- 模式二：函数系数法 (y = ax² + bx + c) ---
        const aStr = params.get('a');
        const bStr = params.get('b');
        const cStr = params.get('c');

        if (aStr !== undefined && bStr !== undefined && cStr !== undefined) {
            const a = this.getNumberValue(params, 'a');
            const b = this.getNumberValue(params, 'b');
            const c = this.getNumberValue(params, 'c');

            if (a == null || b == null || c == null || isNaN(a) || isNaN(b) || isNaN(c)) {
                throw new Error('Parameters a, b, c must be numbers.');
            }
            if (a === 0) {
                throw new Error('Parameter "a" cannot be zero for a parabola.');
            }

            // --- 从 y=ax²+bx+c 转换到 vertex, pValue, rotateAngle ---

            // 1. 计算顶点 (h, k)
            // h = -b / (2a)
            const h = -b / (2 * a);
            // k = a*h² + b*h + c
            const k = a * h * h + b * h + c;
            // 为这个计算出的顶点创建一个临时的Point对象
            const vertex = new Point(`${name}_vertex`, h, k);

            // 2. 计算 pValue
            // 标准形式 (x-h)² = 4f(y-k)，其中 f 是焦距。我们有 (x-h)² = (1/a)(y-k)。
            // 所以 4f = 1/a。在我们的 y²=2px 定义中，p=2f，所以对于垂直抛物线 x²=2py，p = 1/(2a)。
            // pValue 只表示开口大小，不关心方向，所以取绝对值。
            const pValue = Math.abs(1 / (2 * a));

            // 3. 计算旋转角度
            // 我们的标准模型 y²=2px 是向右开口的。
            // y = ax²... 中 a>0 (开口向上) 相当于标准模型逆时针旋转270度，即-90度。
            // a<0 (开口向下) 相当于标准模型逆时针旋转90度。
            const rotateAngle = (a > 0) ? -90 : 90;

            const parabola = new Parabola(name, vertex, pValue, rotateAngle);
            this.state.objects.set(name, parabola);
            // （可选）如果希望这个计算出的顶点也能被其他指令引用，可以也把它加入到对象列表

            const draw = params.get('draw');
            if (draw != null && draw == 'true' && this.state.ctx) {
                this.collectDraw(params, parabola);
            }

            return;
        }

        // --- 如果参数不匹配任何一种模式，则报错 ---
        throw new Error('To create a parabola, provide either {vertex, pValue, rotateAngle} or {a, b, c} parameters.');
    }

    private createHyperbola(params: Map<string, string>): void {
        const name = params.get('name') || params.get('n');
        if (!name) {
            throw new Error('Hyperbola command requires a "name" parameter.');
        }

        // --- 模式一：几何参数法 (center, aValue, bValue, rotateAngle) ---
        const centerName = params.get('center') || params.get('c');
        const aValueStr = params.get('aValue') || params.get('a');
        const bValueStr = params.get('bValue') || params.get('b');
        const rotateAngleStr = params.get('rotateAngle') || params.get('rot') || '0';

        if (centerName && aValueStr && bValueStr && rotateAngleStr) {
            const center = this.getObject(centerName);
            if (!center || !(center instanceof Point)) {
                throw new Error(`Invalid center name for hyperbola: ${centerName}`);
            }

            const aValue = this.getNumberValue(params, 'aValue') || this.getNumberValue(params, 'a');
            const bValue = this.getNumberValue(params, 'bValue') || this.getNumberValue(params, 'b');
            const rotateAngle = this.getNumberValue(params, 'rotateAngle') || this.getNumberValue(params, 'rot') || 0;

            if (aValue == null || bValue == null || rotateAngle == null ||
                isNaN(aValue) || isNaN(bValue) || isNaN(rotateAngle) || aValue <= 0 || bValue <= 0) {
                throw new Error('Invalid aValue, bValue or rotateAngle. They must be positive numbers.');
            }

            const hyperbola = new Hyperbola(name, center, aValue, bValue, rotateAngle);
            this.state.objects.set(name, hyperbola);

            const draw = params.get('draw');
            if (draw != null && draw == 'true' && this.state.ctx) {
                this.collectDraw(params, hyperbola);
            }

            return;
        }

        // --- 模式二：焦点定义法 (f1, f2, diff) ---
        const f1Name = params.get('f1');
        const f2Name = params.get('f2');
        const diffStr = params.get('diff');

        if (f1Name && f2Name && diffStr) {
            const f1 = this.getObject(f1Name);
            const f2 = this.getObject(f2Name);
            if (!f1 || !(f1 instanceof Point) || !f2 || !(f2 instanceof Point)) {
                throw new Error(`Invalid foci names for hyperbola: ${f1Name}, ${f2Name}`);
            }

            const diff = this.getNumberValue(params, 'diff');
            if (diff == null || isNaN(diff) || diff <= 0) {
                throw new Error('Invalid "diff" value. It must be a positive number.');
            }

            // --- 从 f1, f2, diff 转换到 center, a, b, angle ---

            // 1. 计算中心点 (f1, f2 的中点)
            const centerX = (f1.x + f2.x) / 2;
            const centerY = (f1.y + f2.y) / 2;
            const center = new Point(`${name}_center`, centerX, centerY);

            // 2. 计算半实轴长 a (等于距离差的一半)
            const aValue = diff / 2;

            // 3. 计算焦距 c (等于中心到任一焦点的距离)
            const cValue = Math.sqrt(Math.pow(f1.x - centerX, 2) + Math.pow(f1.y - centerY, 2));

            // 4. 验证构造条件：对于双曲线，必须满足 c > a
            if (cValue <= aValue) {
                throw new Error(`Hyperbola construction failed: distance between foci (${2 * cValue}) must be greater than the constant difference (${diff}).`);
            }

            // 5. 计算半虚轴长 b (b² = c² - a²)
            const bValue = Math.sqrt(cValue * cValue - aValue * aValue);

            // 6. 计算旋转角度 (即焦点连线F1F2的角度)
            const angleRad = Math.atan2(f2.y - f1.y, f2.x - f1.x);
            const rotateAngle = angleRad * (180 / Math.PI);

            const hyperbola = new Hyperbola(name, center, aValue, bValue, rotateAngle);
            this.state.objects.set(name, hyperbola);

            const draw = params.get('draw');
            if (draw != null && draw == 'true' && this.state.ctx) {
                this.collectDraw(params, hyperbola);
            }

            return;
        }

        // --- 如果参数不匹配任何一种模式，则报错 ---
        throw new Error('To create a hyperbola, provide either {center, aValue, bValue, rotateAngle} or {f1, f2, diff} parameters.');
    }


    private createAngle(params: Map<string, string>): void {
        // 实现角度创建
        const name = params.get('name');
        const vertexName = params.get('vertex') || params.get('v');
        const point1Name = params.get('p1');
        const point2Name = params.get('p2');
        const angleValue = this.getNumberValue(params, 'angle') || this.getNumberValue(params, 'a') || 0; // 角度值
        const showArc = GeometryDSLInterpreter.parseBoolean(params.get('showArc') || 'true');

        if (!name || !vertexName || !point1Name) {
            throw new Error('ANGLE command requires name, vertex, p1, and p2 parameters');
        }

        const vertex = this.getObject(vertexName);
        const point1 = this.getObject(point1Name);

        if (point2Name) {
            // 通过点2创建角度
            const point2 = this.getObject(point2Name);

            if (!vertex || !point1 || !point2) {
                throw new Error(`Points ${vertexName}, ${point1Name}, or ${point2Name} not found`);
            }

            // 这里需要创建实际的Angle对象
            const angle = new Angle(name, vertex as Point, point1 as Point, point2 as Point, showArc);
            this.state.objects.set(name, angle);

            const draw = params.get('draw');
            if (draw != null && draw == 'true' && this.state.ctx) {
                this.collectDraw(params, angle);
            }

        } else {
            // 通过一条边和角度值创建角度
            if (!vertex || !point1) {
                throw new Error(`Points ${vertexName} or ${point1Name} not found`);
            }

            const tempSegment = new Segment(name + '_<temp>', vertex as Point, point1 as Point);
            const point2Pos = tempSegment.rotateAroundPoint(angleValue * Math.PI / 180, vertex as Point, false);
            const point2 = new Point(name + '_<point2>', point2Pos.p2.x, point2Pos.p2.y);
            this.state.objects.set(point2.name, point2);

            // 这里需要创建实际的Angle对象
            const angle = new Angle(name, vertex as Point, point1 as Point, point2, showArc);
            this.state.objects.set(name, angle);

            const draw = params.get('draw');
            if (draw != null && draw == 'true' && this.state.ctx) {
                this.collectDraw(params, angle);
            }
        }

        // console.log(`Created angle ${name} with vertex ${vertexName}, point1 ${point1Name}, and point2 ${point2Name}`);
    }

    private createFocis(params: Map<string, string>): void {
        // 实现焦点创建
        const name = params.get('name');
        const objectName = params.get('obj') || params.get('o');

        if (!name || !objectName) {
            throw new Error('FOCUS command requires name and point parameters');
        }

        const obj = this.getObject(objectName);
        if (!obj) {
            throw new Error(`Point ${objectName} not found`);
        }

        // 如果对象不是椭圆，双曲线，或抛物线，则抛出错误
        if (!(obj instanceof Ellipse)) {
            throw new Error(`Object ${objectName} is not a valid conic section for focus creation`);
        }

        if (obj instanceof Ellipse) {
            // 将name按逗号分割成两个
            const parts = name.split(',');
            if (parts.length !== 2) {
                throw new Error('FOCUS command requires name to be in format "focus1,focus2" for ellipse');
            }

            // 获取椭圆的焦点
            const objEllipse = obj as Ellipse;
            const points = objEllipse.getFoci();

            const pt1 = new Point(parts[0].trim(), points[0].x, points[0].y);
            const pt2 = new Point(parts[1].trim(), points[1].x, points[1].y);

            this.state.objects.set(pt1.name, pt1);
            this.state.objects.set(pt2.name, pt2);

            const draw = params.get('draw');
            if (draw != null && draw == 'true' && this.state.ctx) {
                this.collectDraw(params, pt1);
                this.collectDraw(params, pt2);
            }
        }
    }

    // 创建随机点
    private createRandomPoint(params: Map<string, string>): void {
        const name = params.get('name');
        const objName = params.get('obj') || params.get('o');

        if (!name || !objName) {
            throw new Error('RANDOMPOINT command requires name, obj parameter');
        }

        const start = params.get('start') || params.get('s');
        const end = params.get('end') || params.get('e');
        const randomSource = `RANDOMPOINT obj=${objName}${start !== undefined ? ` start=${start}` : ''}${end !== undefined ? ` end=${end}` : ''}`;
        const frozenPoint = this.state.frozenRandomObjects.get(name);

        const obj = this.getObject(objName);
        if (!obj) {
            throw new Error(`Object ${objName} not found`);
        }

        if (obj instanceof LinearObject) {
            // 在直线上随机生成点
            const line = obj as LinearObject;
            const startPos = parseFloat(start || '0');
            const endPos = parseFloat(end || '1');
            const randomPoint = frozenPoint || line.randomPointOnLine(startPos, endPos);
            const point = new Point(name, randomPoint.x, randomPoint.y);
            this.state.objects.set(name, point);
            this.state.randomObjectSources.set(name, randomSource);

            const draw = params.get('draw');
            if (draw != null && draw == 'true' && this.state.ctx) {
                this.collectDraw(params, point);
            }

            return;
        }

        if (obj instanceof Circle) {
            // 在圆内随机生成点
            const circle = obj as Circle;
            const startAngle = parseFloat(start || '0');
            const endAngle = parseFloat(end || '360');
            const randomPoint = frozenPoint || circle.randomPointOnEdge(startAngle, endAngle);
            const point = new Point(name, randomPoint.x, randomPoint.y);
            this.state.objects.set(name, point);
            this.state.randomObjectSources.set(name, randomSource);

            const draw = params.get('draw');
            if (draw != null && draw == 'true' && this.state.ctx) {
                this.collectDraw(params, point);
            }

            return;
        }

        if (obj instanceof Ellipse) {
            // 在椭圆内随机生成点
            const ellipse = obj as Ellipse;
            const startAngle = parseFloat(start || '0');
            const endAngle = parseFloat(end || '360');
            const randomPoint = frozenPoint || ellipse.randomPointOnEdge(startAngle, endAngle);
            const point = new Point(name, randomPoint.x, randomPoint.y);
            this.state.objects.set(name, point);
            this.state.randomObjectSources.set(name, randomSource);

            const draw = params.get('draw');
            if (draw != null && draw == 'true' && this.state.ctx) {
                this.collectDraw(params, point);
            }

            return;
        }
    }

    /* 创建插槽，插槽用于几何体属性的数值动态计算，语法为{slot}, 
    * 示例：
    * create slot name=slot_A value=10
    * create point name=A x={slot_A}, y={slot_A * 2}
    * 这样可以在几何体中使用插槽的值进行动态计算。
    * */
    private createSlot(params: Map<string, string>): void {
        const name = params.get('name');
        const valueString = params.get('value') || params.get('v') || params.get('expression') || params.get('e');

        if (!name || !valueString) {
            throw new Error('SLOT command requires name and expression parameters');
        }

        // Slot 类型，默认为数值（包括表达式），如果需要设置字符串类型的Slot，则需要设置为string
        const slotType = params.get('type') || params.get('t') || 'number';
        const isRandomExpression = /\brandom\s*\(/i.test(valueString);
        if (slotType.toLowerCase() === 'string') {
            this.state.slots.set(name, valueString);
            this.state.variableInfo.set(name, {
                name,
                expression: valueString,
                value: valueString,
                kind: 'fixed',
                frozen: false,
            });
        } else {
            const existingFrozenValue = isRandomExpression ? this.state.frozenRandomValues.get(name) : undefined;
            const value = existingFrozenValue ?? (this.getNumberValue(params, 'value') || this.getNumberValue(params, 'v')
                || this.getNumberValue(params, 'expression') || this.getNumberValue(params, 'e') || 0);

            this.state.slots.set(name, value);
            this.state.variableInfo.set(name, {
                name,
                expression: valueString,
                value,
                kind: isRandomExpression ? 'random' : 'fixed',
                frozen: isRandomExpression && existingFrozenValue !== undefined,
            });
        }

    }

    /* 创建函数，插槽用于几何体属性的数值动态计算，语法为{func(x, y)}, 
    * args 为参数个数，在表达式中可以使用 args[1]代表第一个参数, args[2] 代表第二个参数
    * 示例：
    * create function name=vector_length args=2 value={sqrt(args[1] * args[1] + args[2] * args[2])}
    * create point name=A x=3, y=4
    * print m=(3, 4) length is {vector(3, 4)}
    * 这样可以在几何体中使用函数进行动态计算。
    * */
    private createFunction(params: Map<string, string>): void {
        const name = params.get('name') || params.get('n');
        const argsStr = params.get('args') || params.get('a');
        let value = params.get('value') || params.get('v') || params.get('expression') || params.get('e');

        if (!name || !argsStr || value === undefined) {
            throw new Error('FUNCTION command requires "name", "args", and "value" parameters.');
        }

        // 检查函数名是否与已存在的自定义函数冲突
        if (this.state.functions.has(name)) {
            throw new Error(`Function name "${name}" is already defined.`);
        }

        // (注意: 与内置函数的冲突检查将在 calculate 模块中进行)

        const argCount = parseInt(argsStr, 10);
        if (isNaN(argCount) || argCount < 0) {
            throw new Error(`Invalid number of arguments: ${argsStr}`);
        }

        // 移除表达式两边的花括号
        if (value.startsWith('{') && value.endsWith('}')) {
            value = value.slice(1, -1);
        }

        const customFunction: CustomFunction = {
            name,
            argCount,
            expression: value,
        };

        this.state.functions.set(name, customFunction);
        // this.state.onMessage?.('info', 0, `Created function ${name} with ${argCount} arguments.`);
    }

    /**
     * 创建曲线，需要传递一个Function对象。
     * 
     */
    private createCurve(params: Map<string, string>): void {
        const name = params.get('name') || params.get('n');
        const funcName = params.get('func') || params.get('f');
        const xStart = this.getNumberValue(params, 'xstart') || this.getNumberValue(params, 'xs') || 0;
        const xEnd = this.getNumberValue(params, 'xend') || this.getNumberValue(params, 'xe') || 0;

        // 检查必需参数
        if (!name || !funcName) {
            throw new Error('CURVE command requires name and func parameters.');
        }

        // 查找并验证函数
        const customFunction = this.state.functions.get(funcName);
        if (!customFunction) {
            throw new Error(`Function "${funcName}" not found.`);
        }
        if (customFunction.argCount !== 1) {
            throw new Error(`Function "${funcName}" must have exactly one argument for CURVE.`);
        }

        // 创建曲线的 lambda 函数。
        // 这个函数会接收一个 x 值，然后调用 executeSlotExpression 来计算表达式。
        const curveLambda = (x: number): number => {
            // 传递表达式和参数映射，进行计算
            this.state.slots.set('args[1]', x);
            
            const result = this.executeSlotExpression(customFunction.expression);
            return result;
        };

        // 创建 Curve 对象
        const curve = new Curve(name, xStart, xEnd, curveLambda, null);
        this.state.objects.set(name, curve);

        // 检查是否需要自动绘制
        const draw = params.get('draw');
        if (draw === 'true' && this.state.ctx) {
            this.collectDraw(params, curve);
        }
    }

    private createAnimation(params: Map<string, string>): void {
        const name = params.get('name');
        const rawInterval = parseFloat(params.get('interval') || '1000'); // 默认1秒
        // interval 单位毫秒；0 表示「每个 requestAnimationFrame 都推进一帧」，即跟随显示器刷新率。
        // 非法值退回默认 1 秒，否则 NaN 会让「到点没有」的判断永远为真，动画变成满速空转。
        const interval = Number.isFinite(rawInterval) && rawInterval >= 0 ? rawInterval : 1000;
        const repeat = GeometryDSLInterpreter.parseBoolean(params.get('repeat') || 'false');
        // period 表示一个完整周期包含的帧数，主要供 SVG 导出采样。
        // frames / periodFrames 作为兼容别名保留，period 是推荐写法。
        const periodValue = params.get('period') || params.get('frames') || params.get('periodFrames');
        const parsedPeriod = periodValue === undefined ? NaN : Number(periodValue);
        const period = Number.isInteger(parsedPeriod) && parsedPeriod > 0 ? parsedPeriod : undefined;
        // 执行代码
        const code = params.get('code') || params.get('c');
        const slotName = params.get('slot') || params.get('s');

        if (!name || !code || !slotName) {
            throw new Error('ANIMATION command requires name, execute, update parameter');
        }

        // 如果已经存在这个动画，那么设置这个动画对象结束标记
        if (this.state.animations.has(name)) {
            const existingAnimation = this.state.animations.get(name);
            if (existingAnimation) {
                existingAnimation.isRunning = false;
                console.log(`Animation ${name} already exists, stopping it before creating a new one.`);
            }
        }

        if (!this.state.codes.has(code)) {
            throw new Error(`Animation ${name}: code ${code} not found`);
        }

        // 创建插槽
        this.state.slots.set(slotName, 0);

        // 创建动画对象
        const animation: AnimationState = {
            name: name,
            code: code,
            slot: slotName,
            isRepeat: repeat,
            currentFrame: 0,
            interval: interval,
            period,
            isRunning: true,
            lastFrameTime: -1
        };

        this.state.animations.set(name, animation);

        // 交互模式接入 rAF 循环（所有动画共用一条）；
        // 离线导出模式由 stepAnimation 手动逐帧采样。
        if (this.state.animationAutoStart) {
            this.startAnimationLoop();
        }

        // console.log(`Created animation ${name} with code ${code} interval ${interval}ms and repeat ${repeat}`);
    }

    // 启动驱动循环。已经在跑就什么都不做，所以可以放心地每个动画各调一次。
    private startAnimationLoop(): void {
        if (!this.state.animationAutoStart) return;
        if (this.scheduledFrame) return;
        this.scheduleAnimationFrame(this.onAnimationFrame);
    }

    // 调度下一次动画帧。
    // 浏览器走 requestAnimationFrame：回调与浏览器绘制同频，标签页隐藏时自动暂停，
    // 也不会像 setTimeout 那样在后台继续排队、攒出一堆待执行的定时器。
    // Node（离线测试 / SVG 导出）没有 rAF，退回 setTimeout，行为与旧实现一致。
    private scheduleAnimationFrame(callback: (timestamp: number) => void): void {
        if (typeof requestAnimationFrame === 'function') {
            const handle = requestAnimationFrame(callback);
            this.scheduledFrame = { cancel: () => cancelAnimationFrame(handle) };
            return;
        }
        const handle = setTimeout(() => callback(this.animationNow()), 0);
        this.scheduledFrame = { cancel: () => clearTimeout(handle) };
    }

    private cancelScheduledFrame(): void {
        this.scheduledFrame?.cancel();
        this.scheduledFrame = null;
    }

    private animationNow(): number {
        return typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now();
    }

    // 一个 rAF 回调驱动全部动画：每个动画用自己的 lastFrameTime 做节流，
    // 到点的才跑 CODE 块，因此不同 interval 的动画可以共存且互不干扰。
    private onAnimationFrame = (timestamp: number): void => {
        this.scheduledFrame = null;
        if (!this.state.animationAutoStart) return;

        const now = Number.isFinite(timestamp) ? timestamp : this.animationNow();
        let hasRunningAnimation = false;

        for (const animation of Array.from(this.state.animations.values())) {
            if (!animation.isRunning) continue;
            // 第一帧不等间隔，动画一创建就先画出来。
            const isFirstFrame = animation.lastFrameTime < 0;
            if (!isFirstFrame && now - animation.lastFrameTime < animation.interval) {
                hasRunningAnimation = true;
                continue;
            }
            animation.lastFrameTime = now;
            this.runAnimationCode(animation);
            if (animation.isRunning) hasRunningAnimation = true;
        }

        // 全部跑完（非循环动画播完最后一帧）就自然停下，不再空转。
        if (hasRunningAnimation) this.startAnimationLoop();
    };

    // 执行一帧：跑 CODE 块、推进帧号与插槽。
    // 只负责「跑一帧」，不负责调度 —— 调度在 onAnimationFrame，离线导出走 stepAnimation。
    private runAnimationCode(animation: AnimationState): void {
        if (!this.state.ctx) return;

        const commands = this.state.codes.get(animation.code);
        if (!commands) {
            console.error(`Animation ${animation.name}: code ${animation.code} not found`);
            // 旧实现靠「不再挂定时器」自然停住；现在循环由 isRunning 决定去留，
            // 这里必须显式停掉，否则循环会一直空转。
            animation.isRunning = false;
            return;
        }

        // 执行代码片段
        this.executeLines(toLogicalLines(commands), false);

        // CODE 块自己把动画停掉了（例如重名重建），这一帧就不再推进帧号。
        if (animation.isRunning === false) {
            console.log(`Animation ${animation.name} is not running, stopping execution.`);
            return;
        }

        // 更新动画状态
        animation.currentFrame++;
        // 更新slot
        this.state.slots.set(animation.slot, animation.currentFrame);
        if (!animation.isRepeat) {
            // 如果不是循环动画，则停止
            animation.isRunning = false;
            console.log(`Animation ${animation.name} completed after ${animation.currentFrame} frames`);
        }
    }

    private parseColor(params: Map<string, string>, key: string): string | undefined;
    // private parseColor(colorString: string): string | undefined;
    private parseColor(args1: Map<string, string>, args2: string): string | undefined {
        const parseColorInternal = (colorString: string | undefined): string | undefined => {
            // 首先，处理 null, undefined 或空字符串的边缘情况，直接返回。
            if (!colorString) {
                return colorString;
            }

            // 定义一个正则表达式，用于严格匹配一个由6个十六进制字符组成的字符串。
            // ^ - 匹配字符串的开头
            // [0-9a-fA-F] - 匹配任何一个十六进制字符（数字0-9，字母a-f，不区分大小写）
            // {6} - 表示前面的模式必须精确匹配6次
            // $ - 匹配字符串的结尾
            const hexRegex = /^[0-9a-fA-F]{6}$/;

            // 使用正则表达式的 test() 方法来检查输入字符串是否匹配该模式。
            if (hexRegex.test(colorString)) {
                // 如果匹配成功，说明它是一个6位的十六进制颜色码。
                // 我们为其加上 '#' 前缀，并转换为大写以保持格式统一。
                return `#${colorString.toUpperCase()}`;
            } else {
                // 如果不匹配，我们假定它是一个颜色名（如 'red'）或一个已经格式化好的颜色值（如 '#FF00FF'）。
                // 在这种情况下，我们直接返回原始字符串，不做任何处理。
                return colorString;
            }
        }

        const params = args1 as Map<string, string>;
        const colorValue = params.get(args2);
        if (colorValue == null) {
            return undefined;
        }
        const reg = /\{([^}]+)\}/;
        if (reg.test(colorValue)) {
            const slotName = reg.exec(colorValue)![1].trim();
            const slotValue = this.state.slots.get(slotName);
            if (slotValue == null) {
                return undefined;
            }

            return parseColorInternal(slotValue.toString());
        } else {
            return parseColorInternal(colorValue);
        }
    }

    // 辅助方法
    private drawLabel(
        obj: GeometricObject,
        label: string,
        params: Map<string, string>,
        transform: { scale: number; offsetX: number; offsetY: number },
        labelId: string,
    ): void {
        if (!this.state.ctx) return;

        let direction = params.get('direction') || params.get('d') || 'down';
        if (direction === 'down' || direction === 'd') direction = 'down';
        if (direction === 'up' || direction === 'u') direction = 'up';
        if (direction === 'left' || direction === 'l') direction = 'left';
        if (direction === 'right' || direction === 'r') direction = 'right';
        if (direction !== 'down' && direction !== 'up' && direction !== 'left' && direction !== 'right') {
            throw new Error(`Invalid label direction: ${direction}. Use 'up', 'down', 'left', or 'right'.`);
        }

        // 默认字体来自 `SET item=labelFont`（形如 "12px Arial"）；指令上显式写的
        // fontSize / fontFamily 优先。默认值 '12px Arial' 与历史硬编码一致 → 不设 SET 时不变。
        const fontParts = /(\d+(?:\.\d+)?)px\s*(.*)$/.exec(this.state.defaultOptions.labelFont);
        const defaultFontSize = fontParts ? parseFloat(fontParts[1]) : 12;
        const defaultFontFamily = fontParts && fontParts[2].trim() ? fontParts[2].trim() : 'Arial';
        const fontSize = parseFloat(params.get('fontSize') || params.get('fs') || String(defaultFontSize));
        const fontFamily = params.get('fontFamily') || defaultFontFamily;
        const padding = parseFloat(params.get('padding') || params.get('p') || '2');
        const savedPosition = this.state.labelPositions.get(labelId);
        const isSelected = this.state.selectedObjectNames.has(obj.name)
            || this.state.selectedObjectName === obj.name;
        const isLabelSelected = this.state.selectedLabelId === labelId;
        const labelOptions = {
            drawDirection: direction as 'down' | 'up' | 'left' | 'right',
            fontSize,
            fontFamily,
            // 点标签要绕开点的显示半径，口径必须和绘制/命中一致。
            defaultPointRadiusPixels: this.state.defaultOptions.pointRadius,
            color: isSelected || isLabelSelected
                ? SELECTED_OBJECT_COLOR
                : this.parseColor(params, 'color') || this.parseColor(params, 'c') || this.state.defaultOptions.labelColor,
            backgroundColor: this.parseColor(params, 'backgroundColor') || this.parseColor(params, 'bgc') || 'transparent',
            padding,
            position: savedPosition,
        };

        this.state.ctx.save();
        this.state.ctx.font = `normal normal ${fontSize}px ${fontFamily}`;
        const textWidth = this.state.ctx.measureText(label).width;
        const textHeight = fontSize > 0 ? fontSize : 12;
        const defaultPosition = obj.getDrawLabelPosition(transform, labelOptions, textWidth, textHeight);
        const labelPosition = savedPosition
            ? toScreenPoint(savedPosition.x, savedPosition.y, transform)
            : defaultPosition;
        this.state.ctx.restore();

        // 记录标签的实际绘制位置和屏幕包围盒，供独立选择与拖动使用。
        const logicalPosition = savedPosition || {
            x: (defaultPosition.x - transform.offsetX) / transform.scale,
            y: (transform.offsetY - defaultPosition.y) / transform.scale,
        };
        const labelOptionsWithPosition = { ...labelOptions, position: logicalPosition };
        obj.drawLabel(this.state.ctx, transform, label, labelOptionsWithPosition);
        this.state.labelHitRegions.push({
            id: labelId,
            objectName: obj.name,
            x: labelPosition.x - padding,
            y: labelPosition.y - textHeight - padding,
            width: textWidth + padding * 2,
            height: textHeight + padding * 2,
            position: logicalPosition,
        });
    }

    /**
     * 在当前画布视图中查找命中的对象或标签。
     * 标签返回独立 id，不再与所属几何对象混用选择状态。
     */
    public hitTestSelection(
        screenX: number,
        screenY: number,
        tolerancePx: number,
        view: CanvasView,
    ): CanvasSelection {
        const canvas = this.state.canvas;
        if (!canvas || !isUsableView(view)) return null;

        const viewScale = this.state.defaultOptions.scale;
        const baseOffsetX = canvas.width / 2 - this.state.defaultOptions.centerX * viewScale;
        const baseOffsetY = canvas.height / 2 - this.state.defaultOptions.centerY * viewScale;
        // 这个变换把逻辑坐标一步算到屏幕像素（含外层平移/缩放/旋转），
        // 与渲染路径「先行变换 + 后外层矩阵」的合成结果逐字节相同。
        const rotation = this.getTotalRotationRadians(view.rotation);
        const pivot = viewPivot(canvas.width, canvas.height);
        const transform: DrawTransform = {
            scale: view.scale * viewScale,
            offsetX: view.x + view.scale * baseOffsetX,
            offsetY: view.y + view.scale * baseOffsetY,
            // 与 drawObject 保持一致：Canvas 路径下像素缩放 = 画布自身的 setTransform scale。
            // 命中半径（屏幕像素）需要这个值除掉，才能在大画布缩放下保持「贴着可见圆」。
            pixelScale: view.scale,
            rotation,
            pivot,
        };
        const point = { x: screenX, y: screenY };
        // 标签命中区是按**变换前**的矩形记下来的（见 drawLabel），有旋转时要把屏幕点
        // 反旋转回那个坐标系再比，否则标签一转过角度就点不中。
        const labelPoint = rotation ? rotateAbout(point, pivot, -rotation) : point;
        const tolerance = Math.max(6, tolerancePx);
        const pointTolerance = Math.min(tolerance, 7);
        const labelTolerance = Math.min(tolerance, 6);

        const checked = new Set<string>();
        // 点标记优先于标签、线或区域，避免标签的矩形区域遮住点本身。
        for (let i = this.state.renderedObjectNames.length - 1; i >= 0; i--) {
            const name = this.state.renderedObjectNames[i];
            if (checked.has(name)) continue;
            checked.add(name);
            const object = this.state.objects.get(name);
            if (object instanceof Point && this.hitTestObject(object, point, pointTolerance, transform)) {
                return { kind: 'object', name: object.name };
            }
        }
        // 即使点没有单独的 DRAW 命令，也允许在其可见位置附近选中。
        // 点的命中半径只有几像素，不像直线那样会拉出横跨画布的隐形墙，
        // 所以这里保留全表兜底：线段端点这类「没单独画但位置可见」的点仍然抓得到。
        for (const [name, object] of this.state.objects) {
            if (checked.has(name)) continue;
            if (object instanceof Point && this.hitTestObject(object, point, pointTolerance, transform)) {
                return { kind: 'object', name: object.name };
            }
        }

        // TEXT 是独立的可编辑元素，不应被当作普通几何标签处理。
        // 命中区域按绘制顺序逆序检查，后绘制的文本优先。
        for (let i = this.state.textHitRegions.length - 1; i >= 0; i--) {
            const region = this.state.textHitRegions[i];
            const baseline = toScreenPoint(region.x, region.y, transform);
            const textScale = view.scale;
            const textWidth = region.width * textScale;
            const textAscent = region.ascent * textScale;
            const textDescent = region.descent * textScale;
            if (
                point.x >= baseline.x - labelTolerance &&
                point.x <= baseline.x + textWidth + labelTolerance &&
                point.y >= baseline.y - textAscent - labelTolerance &&
                point.y <= baseline.y + textDescent + labelTolerance
            ) {
                return { kind: 'object', name: region.objectName };
            }
        }

        // 标签文字仍然优先于线和区域，点击文字本身会返回独立标签选择。
        for (let i = this.state.labelHitRegions.length - 1; i >= 0; i--) {
            const region = this.state.labelHitRegions[i];
            const labelX = view.x + region.x * view.scale;
            const labelY = view.y + region.y * view.scale;
            const labelWidth = region.width * view.scale;
            const labelHeight = region.height * view.scale;
            if (
                labelPoint.x >= labelX - labelTolerance &&
                labelPoint.x <= labelX + labelWidth + labelTolerance &&
                labelPoint.y >= labelY - labelTolerance &&
                labelPoint.y <= labelY + labelHeight + labelTolerance
            ) {
                return {
                    kind: 'label',
                    id: region.id,
                    objectName: region.objectName,
                    position: { ...region.position },
                    screenAnchor: toScreenPoint(region.position.x, region.position.y, transform),
                };
            }
        }

        // 只命中真正画出来的对象，按绘制顺序逆序检查。
        //
        // 这里曾经把 state.objects 全表当兜底，结果那些「建了但没画」的辅助对象
        // （中垂线、平行线的定义线等）也会参与命中。直线是无限长的，一条看不见的
        // 辅助直线会横跨整张画布形成一条隐形墙：光标明明离所有可见图形很远，
        // 却被判定为压在元素上，于是开锁状态下既不能平移也不能缩放。
        // 判据统一成「看得见才可交互」——只有进入过绘制序列的对象才能被点中。
        checked.clear();
        const candidates = this.state.renderedObjectNames.slice().reverse();
        for (const name of candidates) {
            if (checked.has(name)) continue;
            checked.add(name);
            const object = this.state.objects.get(name);
            if (object && !(object instanceof Point) && this.hitTestObject(object, point, tolerance, transform)) {
                return { kind: 'object', name: object.name };
            }
        }

        return null;
    }

    public screenToLogicalPoint(
        screenX: number,
        screenY: number,
        view: CanvasView,
    ): IPoint | null {
        const canvas = this.state.canvas;
        if (!canvas || !isUsableView(view)) return null;
        const viewScale = this.state.defaultOptions.scale;
        const baseOffsetX = canvas.width / 2 - this.state.defaultOptions.centerX * viewScale;
        const baseOffsetY = canvas.height / 2 - this.state.defaultOptions.centerY * viewScale;
        const fullScale = view.scale * viewScale;
        // 先按画布中心反旋转（顺序与渲染路径相反），再退回视图平移缩放。
        // rotation 为 0 时 unrotated 就是原坐标，与老实现完全一致。
        const unrotated = rotateAbout(
            { x: screenX, y: screenY },
            viewPivot(canvas.width, canvas.height),
            -this.getTotalRotationRadians(view.rotation),
        );
        return {
            x: (unrotated.x - view.x - view.scale * baseOffsetX) / fullScale,
            y: (view.y + view.scale * baseOffsetY - unrotated.y) / fullScale,
        };
    }

    // 保留旧的对象名命中接口，便于非 UI 调用方继续使用。
    public hitTest(
        screenX: number,
        screenY: number,
        tolerancePx: number,
        view: CanvasView,
    ): string | null {
        const selection = this.hitTestSelection(screenX, screenY, tolerancePx, view);
        if (!selection) return null;
        return selection.kind === 'label' ? selection.objectName : selection.name;
    }

    /**
     * 用「选中高亮」样式在任意 2D 上下文中重绘单个对象。
     *
     * 供点操作对话框使用：对话框里只有一张从主画布复制过来的静态位图，
     * 没有解释器渲染循环，所以这里复用与 drawObject 完全相同的变换与 DrawOptions 计算，
     * 保证高亮的位置、线宽、点半径都和真实几何一致，不会出现「框偏了」的错觉。
     *
     * 变换的分工要和 Canvas 渲染路径保持一致：外层缩放/平移由调用方通过
     * ctx.setTransform 提供，这里只负责 centerX/centerY 造成的视图偏移，
     * 这样 visibleRect 才能沿用 setTransform 里算好的那块「画布坐标」区间。
     */
    public drawObjectHighlight(
        ctx: CanvasRenderingContext2D,
        name: string,
        view: CanvasView,
        options?: { color?: string },
    ): boolean {
        const canvas = this.state.canvas;
        const obj = this.state.objects.get(name);
        if (!canvas || !obj || !isUsableView(view)) return false;

        const viewScale = this.state.defaultOptions.scale;
        const baseOffsetX = canvas.width / 2 - this.state.defaultOptions.centerX * viewScale;
        const baseOffsetY = canvas.height / 2 - this.state.defaultOptions.centerY * viewScale;
        const transform: DrawTransform = {
            scale: viewScale,
            offsetX: baseOffsetX,
            offsetY: baseOffsetY,
            // 下面 ctx.setTransform 用 view.scale 作为外层矩阵，
            // 所以折算默认线宽/点半径的倍率就是 view.scale。
            pixelScale: view.scale,
        };

        const highlightColor = options?.color || SELECTED_OBJECT_COLOR;
        const drawOptions: DrawOptions = {
            highlight: true,
            color: highlightColor,
            // 直线/射线据此裁剪，避免高亮被画到画布外面去。
            visibleRect: this.getVisibleViewRect(),
        };
        if (this.state.defaultOptions.lineLength != null) {
            drawOptions.length = this.state.defaultOptions.lineLength;
        }
        // 实心点用的是 fillStyle，只改 color 是看不出高亮的。
        if (obj instanceof Point) {
            drawOptions.fillColor = highlightColor;
        }

        ctx.save();
        this.applyViewMatrix(ctx, view);
        obj.draw(ctx, transform, drawOptions);
        ctx.restore();
        return true;
    }

    /**
     * 按视图状态设置 ctx 的外层矩阵。与 applyCanvasViewTransform 共用同一份算法 ——
     * 高亮 / 预览是叠加在已渲染画布上的，矩阵只要差一点，红框就会和图形错开。
     */
    private applyViewMatrix(ctx: CanvasRenderingContext2D, view: CanvasView): void {
        const canvas = this.state.canvas;
        if (!canvas) return;
        const matrix = buildCanvasMatrix(view, canvas.width, canvas.height, this.getDeclaredRotationRadians());
        ctx.setTransform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
    }

    /**
     * 用「选中高亮」样式只描出线性对象上的一段，供「截取线段」的悬停预览使用。
     *
     * 和 `drawObjectHighlight` 的分工一样：外层缩放/平移由调用方通过 `ctx.setTransform` 提供，
     * 这里只负责 centerX/centerY 造成的视图偏移。区别是两端可以用 `null` 表示无穷远，
     * 这时按可见区域裁剪 —— 否则一条直线的预览会被画到画布外面去。
     */
    public drawLinearPortionHighlight(
        ctx: CanvasRenderingContext2D,
        name: string,
        view: CanvasView,
        range: { startT: number | null; endT: number | null },
        options?: { color?: string },
    ): boolean {
        const canvas = this.state.canvas;
        const obj = this.state.objects.get(name);
        if (!canvas || !obj || !(obj instanceof LinearObject)) return false;
        if (!isUsableView(view)) return false;

        const viewScale = this.state.defaultOptions.scale;
        const baseOffsetX = canvas.width / 2 - this.state.defaultOptions.centerX * viewScale;
        const baseOffsetY = canvas.height / 2 - this.state.defaultOptions.centerY * viewScale;

        const p1 = obj.p1;
        const p2 = obj.p2;
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const lengthSquared = dx * dx + dy * dy;
        if (!(lengthSquared > 0)) return false;

        // 可见区域的参数范围：把可见区四角换算回逻辑坐标再投影到线上。
        // 走 getVisibleLogicalBounds 而不是自己拿画布四角反算 —— 有视图旋转时
        // 「可见区」不再是画布矩形，少了这一步预览会在角上被提前截断。
        const bounds = this.getVisibleLogicalBounds();
        if (!bounds) return false;
        const corners = [
            { x: bounds.minX, y: bounds.minY },
            { x: bounds.maxX, y: bounds.minY },
            { x: bounds.minX, y: bounds.maxY },
            { x: bounds.maxX, y: bounds.maxY },
        ];
        let visibleLo = Infinity;
        let visibleHi = -Infinity;
        for (const corner of corners) {
            const t = ((corner.x - p1.x) * dx + (corner.y - p1.y) * dy) / lengthSquared;
            visibleLo = Math.min(visibleLo, t);
            visibleHi = Math.max(visibleHi, t);
        }

        const startT = range.startT === null ? visibleLo : Math.max(range.startT, visibleLo);
        const endT = range.endT === null ? visibleHi : Math.min(range.endT, visibleHi);
        if (!(endT > startT)) return false;

        const toBase = (t: number) => ({
            x: baseOffsetX + (p1.x + dx * t) * viewScale,
            y: baseOffsetY - (p1.y + dy * t) * viewScale,
        });
        const start = toBase(startT);
        const end = toBase(endT);

        ctx.save();
        this.applyViewMatrix(ctx, view);
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.strokeStyle = options?.color || SELECTED_OBJECT_COLOR;
        // 预览是界面提示而不是几何图形，所以线宽固定成屏幕上的若干像素，不随缩放变粗变细。
        ctx.lineWidth = 3 / view.scale;
        ctx.setLineDash([9 / view.scale, 5 / view.scale]);
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.restore();
        return true;
    }

    private hitTestObject(
        object: GeometricObject,
        point: IPoint,
        tolerance: number,
        transform: DrawTransform,
    ): boolean {
        if (object instanceof Point) {
            const center = toScreenPoint(object.x, object.y, transform);
            // 命中半径 = 屏幕上点圆的实际半径（像素），不能拿 object.radius × transform.scale
            // 这种「逻辑半径 × 全缩放」的旧写法 —— 大 VIEW scale 或大画布缩放下，
            // 可见圆只有几像素、命中半径却能膨胀到几百像素，导致右键点空白处仍命中点。
            // 见 resolvePointRadius（点半径的语义是「屏幕像素，与 VIEW scale 无关」）。
            const screenRadius = resolvePointRadius(
                object.explicitRadius,
                object.radius,
                transform,
                // 必须和 drawObject 用同一个默认半径，否则「画多大」和「点多容易被点中」会对不上。
                this.state.defaultOptions.pointRadius,
            );
            return Math.hypot(point.x - center.x, point.y - center.y) <= Math.max(tolerance, screenRadius + 4);
        }

        if (object instanceof LinearObject) {
            return this.hitTestLinear(object, point, tolerance, transform);
        }

        if (object instanceof Circle) {
            const center = toScreenPoint(object.center.x, object.center.y, transform);
            const radius = Math.abs(object.radius * transform.scale);
            return Math.abs(Math.hypot(point.x - center.x, point.y - center.y) - radius) <= tolerance;
        }

        if (object instanceof Ellipse) {
            const samples: IPoint[] = [];
            for (let i = 0; i <= 96; i++) {
                const angle = (i / 96) * Math.PI * 2;
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);
                const rotationCos = Math.cos(object.rotation);
                const rotationSin = Math.sin(object.rotation);
                samples.push(toScreenPoint(
                    object.center.x + object.rx * cos * rotationCos - object.ry * sin * rotationSin,
                    object.center.y + object.rx * cos * rotationSin + object.ry * sin * rotationCos,
                    transform,
                ));
            }
            return this.hitTestPolyline(samples, point, tolerance);
        }

        if (object instanceof Polygon) {
            const vertices = object.vertices.map(vertex => toScreenPoint(vertex.x, vertex.y, transform));
            if (this.hitTestPolyline([...vertices, vertices[0]], point, tolerance)) return true;
            return this.isPointInsidePolygon(point, vertices);
        }

        if (object instanceof Curve) {
            const samples: IPoint[] = [];
            const step = Math.max(object.sampleStep, (object.rangeEnd - object.rangeStart) / 800);
            for (let x = object.rangeStart; x <= object.rangeEnd; x += step) {
                samples.push(toScreenPoint(x, object.evaluate(x), transform));
            }
            samples.push(toScreenPoint(object.rangeEnd, object.evaluate(object.rangeEnd), transform));
            return this.hitTestPolyline(samples, point, tolerance);
        }

        if (object instanceof Angle) {
            const line1 = object.line1;
            const line2 = object.line2;
            return Boolean(
                (line1 && this.hitTestLinear(line1, point, tolerance, transform)) ||
                (line2 && this.hitTestLinear(line2, point, tolerance, transform))
            );
        }

        if (object instanceof CircularRegion) {
            const samples = this.sampleCircularRegion(object, transform);
            return this.hitTestPolyline(samples, point, tolerance) || this.isPointInsidePolygon(point, samples);
        }

        if (object instanceof CurveCircleRegion) {
            const samples = object.curvePoints.map(sample => toScreenPoint(sample.x, sample.y, transform));
            return this.hitTestPolyline(samples, point, tolerance) || this.isPointInsidePolygon(point, samples);
        }

        return false;
    }

    private hitTestLinear(
        line: LinearObject,
        point: IPoint,
        tolerance: number,
        transform: DrawTransform,
    ): boolean {
        const start = toScreenPoint(line.p1.x, line.p1.y, transform);
        const end = toScreenPoint(line.p2.x, line.p2.y, transform);
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const lengthSquared = dx * dx + dy * dy;
        if (lengthSquared < 1e-9) return Math.hypot(point.x - start.x, point.y - start.y) <= tolerance;

        const projectedT = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
        // 与 LinearObject.draw 的截止点区间保持一致：看不见的缺口不应再次被右键/左键命中。
        if (!line.isParameterVisible(projectedT)) return false;
        let t = projectedT;
        if (line instanceof Segment) {
            if (t < 0 || t > 1) return false;
        } else if (line instanceof Ray) {
            if (t < 0) return false;
        }
        // Line 使用无限延伸，Ray 只限制起点方向；只有 Segment 需要夹在两个端点之间。
        if (line instanceof Segment) t = Math.max(0, Math.min(1, t));
        const closest = { x: start.x + t * dx, y: start.y + t * dy };
        return Math.hypot(point.x - closest.x, point.y - closest.y) <= tolerance;
    }

    private hitTestPolyline(points: IPoint[], point: IPoint, tolerance: number): boolean {
        for (let i = 1; i < points.length; i++) {
            const start = points[i - 1];
            const end = points[i];
            const dx = end.x - start.x;
            const dy = end.y - start.y;
            const lengthSquared = dx * dx + dy * dy;
            const t = lengthSquared < 1e-9
                ? 0
                : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
            const closest = { x: start.x + t * dx, y: start.y + t * dy };
            if (Math.hypot(point.x - closest.x, point.y - closest.y) <= tolerance) return true;
        }
        return false;
    }

    private isPointInsidePolygon(point: IPoint, vertices: IPoint[]): boolean {
        let inside = false;
        for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
            const a = vertices[i];
            const b = vertices[j];
            const intersects = ((a.y > point.y) !== (b.y > point.y)) &&
                point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
            if (intersects) inside = !inside;
        }
        return inside;
    }

    private sampleCircularRegion(region: CircularRegion, transform: DrawTransform): IPoint[] {
        const samples: IPoint[] = [
            toScreenPoint(region.startPoint.x, region.startPoint.y, transform),
            toScreenPoint(region.endPoint.x, region.endPoint.y, transform),
        ];
        const span = region.counterclockwise
            ? region.arcStartAngle - region.arcEndAngle
            : region.arcEndAngle - region.arcStartAngle;
        const steps = Math.max(16, Math.ceil(Math.abs(span) * 24));
        for (let i = 0; i <= steps; i++) {
            const ratio = i / steps;
            const angle = region.counterclockwise
                ? region.arcStartAngle - span * ratio
                : region.arcStartAngle + span * ratio;
            samples.push(toScreenPoint(
                region.circle.center.x + region.circle.radius * Math.cos(angle),
                region.circle.center.y - region.circle.radius * Math.sin(angle),
                transform,
            ));
        }
        return samples;
    }

    // 公共方法，获取命名对象
    public getObject(name: string): GeometricObject | undefined {
        if (name == null || name === '') {
            return undefined;
        }

        const existNameObject = this.state.objects.get(name);
        if (existNameObject) {
            return existNameObject;
        }

        // TEXT 不在 `state.objects` 里（它不是几何对象，没有几何语义），但画布上的
        // 选择、命中、右键菜单都把它当普通可选中元素对待，一律走 `getObject(name).type`
        // 判类型。这里补一条兜底，返回一个最小的 text 记录 —— 缺了它，文字会被
        // 「查不到类型 → 过滤掉」，右键菜单里永远见不到它。
        const textElement = this.state.textElements.get(name);
        if (textElement) {
            return { name, type: 'text' } as unknown as GeometricObject;
        }

        const existSlotValue = this.state.slots.get(name);
        if (existSlotValue !== undefined) {
            return this.state.objects.get(existSlotValue.toString());
        }

        const reg = /\{([^}]+)\}/;
        if (reg.test(name)) {
            const slotName = reg.exec(name)![1].trim();
            const slotValue = this.state.slots.get(slotName);
            if (slotValue === undefined) {
                return undefined;
            }

            return this.state.objects.get(slotValue.toString());
        }
    }

    /**
     * 取线性对象的两个定义点名字。
     *
     * 右键菜单里的等分点 / 延长 / 截取线段 / 中垂线都需要「对象自己的两个定义点」：
     * 生成 `CREATE POINT_ON_LINE ... point=<p1>` 这类指令时必须引用真实存在的点对象，
     * 才能让新图形随原图形一起变化；把算出来的坐标硬编码进脚本，一拖动就失效了。
     */
    public getLinearEndpointNames(name: string): { p1: string; p2: string } | null {
        const object = this.getObject(name);
        if (!object || !(object instanceof LinearObject)) return null;
        return { p1: object.p1.name, p2: object.p2.name };
    }

    /**
     * 取一个点对象的**逻辑坐标**。
     *
     * 只为「判断能不能作图」服务：三点共线时外接圆 / 内切圆 / 三角形都做不出来，
     * 这个判断必须用坐标算叉积，光有名字算不了。
     * 真正写进脚本的仍然是**点名**（不是坐标）—— 坐标一拖动就失效了。
     */
    public getPointCoords(name: string): { x: number; y: number } | null {
        const object = this.getObject(name);
        if (!object || !(object instanceof Point)) return null;
        return { x: object.x, y: object.y };
    }

    /**
     * 取**全部点对象**的名字与逻辑坐标。
     *
     * 两个圆求交点时，要先看这两个交点里是不是已经有点存在了 —— 有的话只补建另一个。
     * 判断「点在不在交点上」必须遍历所有点比坐标，光有一个名字算不了。
     * 同样只用于判断，写进脚本的仍是点名，不是坐标。
     */
    public getAllPointCoords(): Array<{ name: string; x: number; y: number }> {
        const result: Array<{ name: string; x: number; y: number }> = [];
        for (const [name, object] of this.state.objects) {
            if (object instanceof Point) {
                result.push({ name, x: object.x, y: object.y });
            }
        }
        return result;
    }

    /**
     * 取线性对象两个定义点的**逻辑坐标**。
     * 「在线上取点」要把鼠标位置投影到线上，光有名字算不了投影，得有真实坐标。
     */
    public getLinearEndpointCoords(name: string): { p1: { x: number; y: number }; p2: { x: number; y: number } } | null {
        const object = this.getObject(name);
        if (!object || !(object instanceof LinearObject)) return null;
        return {
            p1: { x: object.p1.x, y: object.p1.y },
            p2: { x: object.p2.x, y: object.p2.y },
        };
    }

    /**
     * 取「落在某个线性对象上的全部点对象」，按沿线的归一化参数 t 升序返回。
     *
     * 「截取线段」的切割位置必须来自**真实存在的点**：只有点有名字，生成的 DSL 才能引用它，
     * 图形被拖动时切割位置才会跟着走。用鼠标位置临时投影出来的切割点一拖动就和原图形脱钩了。
     *
     * 容差取对象长度的一个极小比例，只滤掉浮点误差，不把「差一点点」的点也算成切割位置。
     */
    public getPointsOnLinear(name: string): Array<{ name: string; t: number }> | null {
        const object = this.getObject(name);
        if (!object || !(object instanceof LinearObject)) return null;

        const p1 = object.p1;
        const p2 = object.p2;
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const lengthSquared = dx * dx + dy * dy;
        if (!(lengthSquared > 0)) return null;
        const length = Math.sqrt(lengthSquared);
        const tolerance = length * 1e-6 + 1e-9;

        const found: Array<{ name: string; t: number }> = [];
        for (const [pointName, candidate] of this.state.objects) {
            if (!(candidate instanceof Point)) continue;
            const offsetX = candidate.x - p1.x;
            const offsetY = candidate.y - p1.y;
            const cross = offsetX * dy - offsetY * dx;
            if (Math.abs(cross) / length > tolerance) continue;
            found.push({
                name: pointName,
                t: (offsetX * dx + offsetY * dy) / lengthSquared,
            });
        }

        found.sort((a, b) => a.t - b.t);
        return found;
    }

    /**
     * 取一个圆对象的圆心点名、圆心逻辑坐标和半径。
     *
     * 右键菜单的「圆操作」（圆周上最近点 / 圆心 / 切线 / 法线）都要先知道圆心和半径：
     * 最近点的角度 = atan2(鼠标.y − 圆心.y, 鼠标.x − 圆心.x)，距离/半径只用来判断能不能做。
     * 写进脚本的仍是 `circle=圆名`，坐标只在菜单里算，不写死进 DSL。
     */
    public getCircleInfo(name: string): { centerName: string; center: { x: number; y: number }; radius: number } | null {
        const object = this.getObject(name);
        if (!object || !(object instanceof Circle)) return null;
        return {
            centerName: object.center.name,
            center: { x: object.center.x, y: object.center.y },
            radius: object.radius,
        };
    }


    // 查找一个点是否已经命名
    public findPoint(x: number, y: number): Point | undefined {
        for (let geoObjectKV of this.state.objects) {
            let geoObject = geoObjectKV[1];
            if (geoObject instanceof Point) {
                const distance = geoObject.distanceTo2(x, y);
                if (distance <= this.zeroThresholdValue) {
                    return geoObject;
                }
            }
        }

        return undefined;
    }

    public getAllObjects(): Map<string, GeometricObject> {
        return new Map(this.state.objects);
    }

    public setCanvas(canvas: HTMLCanvasElement): void {
        this.state.canvas = canvas;
        this.state.ctx = canvas.getContext('2d') || undefined;
    }
}

// 一条“逻辑指令”：可能由原始脚本的多行合并而来（跨行引号值或行末续行），
// 但始终携带它在原始脚本中的物理起始行号（1-based）。
interface LogicalLine {
    text: string;
    line: number;
}

// 代码片段（[ ... ] 内的行）在 RUN / WITH / ANIMATION 时会重新执行，
// 这里还原成带物理行号的逻辑行，保持行号与源码一致。
function toLogicalLines(commands: ParsedCommand[]): LogicalLine[] {
    return commands.map(command => ({ text: command.rawCommand, line: command.lineNumber }));
}

// 把原始脚本切分成可执行的逻辑行，同时保留真实物理行号。
//
// 需要合并成一条逻辑指令的情况有两种：
//   1. 引号值跨行书写（text="..." / message="..." 没在同一行闭合）；
//   2. 行末反斜杠续行。
// 合并后的行号取该组的首行，这样空行、注释、跨行指令都不会让后续指令的
// 行号发生偏移——UI 里上报的行号与编辑器里看到的行号完全一致。
function buildLogicalLines(script: string): LogicalLine[] {
    // 统一去掉 CRLF 的 \r，避免跨行合并时把 \r 留在参数值中间。
    const physical = script.split('\n').map(line => line.replace(/\r$/, ''));

    // 第一遍：合并未闭合的引号值。直接拼接（不加分隔符），
    // 避免破坏 LaTeX 的连续性，如 "$m=a^2+bn\n+c$" 必须拼成 "$m=a^2+bn+c$"。
    const merged: LogicalLine[] = [];
    let i = 0;
    while (i < physical.length) {
        const startLine = i + 1;
        let text = physical[i];
        while (hasUnclosedQuotedValue(text)) {
            if (i + 1 >= physical.length) break;
            i++;
            text = text + physical[i];
        }
        merged.push({ text, line: startLine });
        i++;
    }

    // 第二遍：合并行末反斜杠续行。
    // CREATE GRID name=grid \
    // xMin=-10 xMax=10 \
    // ...
    // 反斜杠只在行尾作为续行标记时生效；参数值中的普通反斜杠保持不变。
    const out: LogicalLine[] = [];
    let pending: string[] = [];
    let pendingLine = 0;
    for (const entry of merged) {
        const line = entry.text;
        const continuation = /\\\s*$/.test(line);
        const content = continuation ? line.replace(/\\\s*$/, '') : line;
        if (pending.length === 0) pendingLine = entry.line;
        pending.push(content.trim());
        if (!continuation) {
            out.push({ text: pending.join(' '), line: pendingLine });
            pending = [];
        }
    }
    if (pending.length > 0) out.push({ text: pending.join(' '), line: pendingLine });
    return out;
}

// 行内是否出现 `键="` 之后缺少成对引号的情况（跨行书写的 text="..." /
// message="..." 等）。仅作为粗略判别：锁定引号起点，再统计从这个 `"` 到行末
// 之间未转义的 `"` 个数（奇数 = 未闭合）。
function hasUnclosedQuotedValue(line: string): boolean {
    const re = /\b\w+="/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(line)) !== null) {
        const quoteIdx = match.index + match[0].length - 1;
        let count = 1;
        let k = quoteIdx + 1;
        while (k < line.length) {
            const ch = line[k];
            if (ch === '\\' && k + 1 < line.length) {
                k += 2;
                continue;
            }
            if (ch === '"') count++;
            k++;
        }
        if (count % 2 === 1) return true;
        re.lastIndex = quoteIdx + 1;
    }
    return false;
}