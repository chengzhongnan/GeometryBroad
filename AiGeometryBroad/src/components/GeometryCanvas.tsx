import React, { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import styled from 'styled-components';
import { FiMaximize, FiMaximize2, FiMinimize2, FiDownload, FiCopy, FiLock, FiUnlock, FiRotateCw, FiPlay, FiPause, FiPlayCircle, FiSkipForward, FiChevronRight, FiMoreHorizontal } from 'react-icons/fi';
import { GeometryDSLInterpreter, type ObjectPropertyKey, type VariableInfo, type CanvasSelection, type TopLevelCommandInfo } from '../core/DSLInterpreter';
import type { IPoint } from '../core/geometry/base';
import { exportScriptToSvg, downloadSvg, copySvgToClipboard } from '../core/svgExport';
import { subscribeKatexUpdates } from '../core/katexRender';
import type { PropertySyncOptions } from '../core/dslPropertySync';
import { planObjectDeletion, type LinearTrimRewrite } from '../core/dslObjectEditing';
import { isDraggableElement, resolveCanvasDragMode, resolveWheelZoom } from './canvasDragMode';
import {
    createView,
    normalizeAngle,
    radiansToDegrees,
    snapAngle,
    viewPivot,
    zoomViewAt,
    type CanvasView,
} from '../core/viewTransform';
import GeometryPickDialog from './GeometryPickDialog';
import LabelEditDialog from './LabelEditDialog';
import TextCreateDialog from './TextCreateDialog';
import {
    buildCreateShapeCommands,
    buildPickOperationCommands,
    buildSelectionOperationCommands,
    buildTwoLineAngleCommands,
    CREATE_SHAPE_CATALOG,
    describePickOperation,
    describeTwoLineAngles,
    resolveAngleSector,
    getPickOperationsForAnchor,
    isLinearType,
    isPointType,
    listLinearPieces,
    PICK_OPERATION_LABELS,
    planLinearPieceRemoval,
    planSelectionOperation,
    planCircleOperation,
    projectOntoLinear,
    TRIANGLE_OBJECT_OPERATIONS,
    type AnglePickGeometry,
    type CommandBuildContext,
    type CreateShapeCatalogEntry,
    type CreateShapeKind,
    type CreateTextSpec,
    type LinearPiece,
    type ObjectRef,
    type PickOperation,
    type PickDescriptorContext,
    type PickOperationSpec,
    type PickStyleOptions,
    type Point2D,
    type SelectionOperation,
    type CircleOperation,
} from '../core/geometryCommandBuilder';
import { parseTextCommandLine, rewriteTextCommandLine } from '../core/textObjectEditing';

// 命中测试的像素容差。hover 光标提示、左键拖动、滚轮缩放守卫全部共用这一个值，
// 避免同一个「算不算命中」的判断散落成几个字面量后逐渐走偏。
const HIT_TOLERANCE = 12;

/** 解释器给角对象的类型名，与 `Angle` 类构造时写进 `super(name, 'Angle')` 的一致。 */
const ANGLE_OBJECT_TYPE = 'Angle';

/**
 * 「两线成角」里两条射线的预览色。
 * 用暖色（琥珀）而不是选中色：这两条射线是要被「变色的那两条」，
 * 得和画布上既有的红色选中高亮区分开。
 */
const ANGLE_RAY_HIGHLIGHT_COLOR = '#f59e0b';

/**
 * 空选右键新建图形的默认尺寸（屏幕像素）。
 *
 * 存的是像素而不是逻辑长度：逻辑长度会随缩放变化，存死数字的话放大到 5 倍时
 * 新建的图形只有指甲盖大。右键那一刻按当前变换折算成逻辑长度，才能「看起来一样大」。
 */
const CREATE_SHAPE_SIZE_PX = 80;

/**
 * 三角形相关操作的菜单项：`[操作 id, 菜单文字, 悬停说明]`。
 *
 * 「选中三个点」和「选中一个三角形」两处共用同一张表 —— 各写一份的话，
 * 以后再加一种「心」必然只加在一处，用户会发现「三点能作、三角形不能作」。
 * 「作三角形」那一项靠 `TRIANGLE_OBJECT_OPERATIONS` 在三角形那条路上被滤掉。
 */
const TRIANGLE_MENU_ITEMS: ReadonlyArray<readonly [SelectionOperation, string, string]> = [
    ['triangle', '三角形', '依次连接这三个点'],
    ['circumcircle', '外接圆', '过这三个点的圆（圆心是外心）'],
    ['incircle', '内切圆', '与三条边都相切的圆（圆心是内心）'],
    ['centroid', '重心', '三条中线的交点'],
    ['orthocenter', '垂心', '三条高的交点'],
    ['incenter', '内心', '三条角平分线的交点（也是内切圆的圆心）'],
    ['circumcenter', '外心', '三条中垂线的交点（也是外接圆的圆心）'],
    ['fermatPoint', '费马点', '到三个顶点距离之和最小的点（有内角 ≥ 120° 时就是那个顶点）'],
    ['excenter', '三个旁心', '每个顶点对面一个，一次建三个点'],
    ['excircle', '三个旁切圆', '每个顶点对面一个，一次建三个圆'],
];

/**
 * 右键菜单每一项的估算高度（8px 上下内边距 + 一行 0.8rem 文字）。只用于决定菜单画在哪。
 * 按实际渲染量出来是 33px 左右，估得越准，「上翻」触发得越恰当。
 */
const CONTEXT_MENU_ITEM_HEIGHT = 33;
/** 菜单标题栏（6px 内边距 + 0.72rem 文字 + 下边框）加菜单自身内边距与边框。 */
const CONTEXT_MENU_CHROME_HEIGHT = 42;

/**
 * 把一串作图项包成 `作图 ▸` 二级菜单；一项都没有时返回 null（不留空分组）。
 *
 * 菜单只做**两级**：顶层是「编辑 / 作图 / 标签 / 删除」这种大分类，
 * 二级是具体操作。三级会让「找一个操作」变成连续两次悬停，反而更慢。
 */
function groupDrawingItems(items: ContextMenuItem[]): ContextMenuItem | null {
    if (items.length === 0) return null;
    return {
        id: 'drawings',
        label: '作图',
        title: '用选中的对象能作出的图形与点',
        children: items,
    };
}

/**
 * 右键菜单该从哪个 y 开始画。
 *
 * 选中三个点时菜单有十项，弹在画布下半部分会直接超出容器底部，
 * 最下面几项（旁切圆、删除）就点不到了 —— 和二级菜单的左右翻转是同一类问题。
 * 三步走：
 *   1. 放得下 → 就用点击位置（正常情况）；
 *   2. 放不下但上方够 → 往上翻（菜单底边贴着光标）；
 *   3. 上下都不够 → 整体上移到刚好贴住容器底边，至少保证整条菜单可见。
 *
 * **不要**改成给菜单加 `overflow: auto` 来「兜底」：二级菜单是菜单框的绝对定位子节点，
 * 一旦有 overflow 就会被裁掉、点不中，还会连带出一条横向滚动条。
 * 菜单真比画布还高时让它溢出到容器外面即可 —— `CanvasContainer` 没有 overflow: hidden。
 */
function contextMenuTop(menu: { y: number; items: ContextMenuItem[] }, canvasHeight: number): number {
    const estimated = CONTEXT_MENU_CHROME_HEIGHT + menu.items.length * CONTEXT_MENU_ITEM_HEIGHT;
    if (menu.y + estimated <= canvasHeight) return menu.y;
    const flipped = menu.y - estimated;
    if (flipped > 0) return flipped;
    return Math.max(0, Math.min(menu.y, canvasHeight - estimated));
}

interface ContextMenuItem {
    id: string;
    label: string;
    /** 悬停提示。裁剪/删除不可用时用它说明原因，比只置灰更容易懂。 */
    title?: string;
    /** 在已选中的两个对象之间作图。 */
    selectionOperation?: SelectionOperation;
    /** 需要先弹对话框的作图，点下去会打开选择对话框。 */
    pickOperation?: PickOperation;
    /** 直接删掉这些对象（已展开依赖闭包），不需要对话框。 */
    deleteObjects?: string[];
    /** 选中一个圆时的作图（圆周最近点 / 圆心 / 切线 / 法线），即时生成、不需要对话框。 */
    circleOperation?: CircleOperation;
    /** 进入「截取线段」的选择模式：鼠标在线上移动时高亮光标所在的一段，单击删掉它。 */
    trimMode?: boolean;
    /**
     * 进入「两线成角」的选择模式：鼠标移到哪个角里，夹出这个角的两条射线就变色，
     * 单击确认作图。需要两条**共端点**的线，不共端点时置灰。
     */
    anglePick?: boolean;
    /** 打开「修改标签」对话框。 */
    editLabel?: boolean;
    /**
     * 打开「编辑对象」对话框：位置 / 半径 / 标签 / 截止点 / 冻结都在里面改。
     * 由上层实现（对话框要的是解释器吐出来的变量快照，那东西在上层手里）。
     */
    editObject?: boolean;
    /**
     * 打开「编辑文字」对话框（TEXT 专用）。
     * 带行号是因为 TEXT 没有 `name=`，通用删除/改写路径按名字找不到它。
     */
    editText?: { lineNumber: number };
    /** 删掉这一条 TEXT 指令（按行号）。 */
    deleteTextLine?: number;
    /**
     * 空选右键时「在此处创建」的图形。点下去才用右键那一刻的逻辑坐标去生成指令 ——
     * 菜单项本身不预生成指令：十个图形各生成一遍，绝大多数是白算的。
     */
    createShape?: CreateShapeKind;
    /** 二级菜单。有它就渲染成「悬停展开」的父项，点父项本身不执行动作。 */
    children?: ContextMenuItem[];
    disabled?: boolean;
}

interface ContextMenuState {
    x: number;
    y: number;
    title: string;
    objects: ObjectRef[];
    items: ContextMenuItem[];
    /**
     * 右键点击处的逻辑坐标。两处在用：
     * 「在线上取点」拿它决定点落在线上哪里；空选右键作图拿它当新图形的落脚点。
     * 必须和菜单一起存下来 —— 菜单弹出来之后鼠标就移开了，届时要不到这个位置。
     */
    anchorPoint?: Point2D | null;
    /** 空选右键作图时「默认尺寸」对应的逻辑长度（按右键那一刻的缩放折算，约 80px）。 */
    creationSize?: number;
}

/**
 * 把「在此处创建」的图形目录翻译成菜单项：分类变成二级菜单，叶子变成可点项。
 *
 * 放在模块作用域是因为它不依赖任何 props / state —— 目录是常量，转换是纯的，
 * 没必要每次右键都重新构造一遍，也没必要为它写一个 hook。
 */
function toCreateMenuItems(entries: readonly CreateShapeCatalogEntry[]): ContextMenuItem[] {
    return entries.map(entry => ({
        id: entry.id,
        label: entry.label,
        title: entry.title,
        createShape: entry.kind,
        children: entry.children ? toCreateMenuItems(entry.children) : undefined,
    }));
}

/** 空选右键的菜单项。目录是常量，转一次就够，不必每次右键重建。 */
const CREATE_MENU_ITEMS: ContextMenuItem[] = toCreateMenuItems(CREATE_SHAPE_CATALOG);

/**
 * 选择对话框的状态；targetName 为 null 表示用户还没在图形里点选目标。
 *
 * 多带一份 `descriptorContext`：描述符要把**真实名字**写进下拉框（顶点叫 `A` 还是 `B`、
 * 参照角有哪些），这些在打开对话框那一刻从解释器取一次就定格，画布和对话框两处
 * 拿到的必须是同一份，否则默认值会对不上。
 */
type PickDialogState = PickOperationSpec & { descriptorContext: PickDescriptorContext };

/**
 * 「修改标签」对话框的状态。
 *
 * 在右键那一刻从解释器把「标签值 + 要写回的行号」定格下来，而不是打开对话框时
 * 再去查 —— 对话框渲染期间脚本可能已经重跑（比如用户同时在敲代码），
 * 那时再查就可能拿到另一份脚本的行号。
 */
interface LabelDialogState {
    name: string;
    type: string;
    value: string;
    lineNumber: number;
    editable: boolean;
    reason?: string;
}

/**
 * 「截取线段」的一次选择会话。
 *
 * 段的两端全部来自线上真实存在的点（对象自己的定义点 + 落在它上面的点对象），
 * 所以切割位置是「依据线上的点」定出来的，而不是把鼠标位置投影上去临时凑一个 ——
 * 后者生成的对象一拖动就和原图形脱钩了。
 */
interface TrimSession {
    anchorName: string;
    anchorType: string;
    /** 沿线的各段，顺序与提示里的编号一致。 */
    pieces: LinearPiece[];
    /** 锚点两个定义点的逻辑坐标，用来把鼠标位置投影到线上并画预览。 */
    p1: Point2D;
    p2: Point2D;
}

/**
 * 鼠标压在线上时解析出来的结果。
 *
 * `index` 只用来画高亮；`t` 是同一份投影结果，交给删除逻辑按
 * 「鼠标所在的相邻两点之间」重算真正要删的那一段。`point` 是投影点，
 * 只用于画高亮预览 —— 删除**不会**拿它去生成任何新点。
 */
interface TrimHover {
    index: number;
    t: number;
}

interface GeometryCanvasProps {
    width: number;
    height: number;
    /** 是否处于全屏作图模式（两侧面板与 Header 已隐藏，画布铺满视口）。 */
    isFullscreen: boolean;
    /** 切换全屏作图模式。状态由 App 持有，画布只负责触发。 */
    onToggleFullscreen: () => void;
    /**
     * 执行代码：把编辑器里的脚本重跑一遍（等价于左侧面板的 Execute Script）。
     *
     * 工具栏上放这个按钮是因为进全屏作图后两侧面板都藏起来了，
     * 没有它就没法重播动画。实现在上层，画布只负责触发。
     */
    onExecute: () => void;
    /**
     * 请求打开「编辑对象」对话框（右键对象 → 编辑对象…）。
     *
     * 对话框本身在上层：它要的是解释器吐出来的变量快照（`getVariables()` 的结果），
     * 而那份快照本来就由上层持有并传给右侧面板 —— 画布不该为了一个对话框再维护一份。
     */
    onRequestObjectEdit: (name: string) => void;
    /**
     * 由外部（变量表面板）发起的对象菜单请求。
     *
     * `id` 每次都要变 —— 同一个对象连着右键两次也得重新弹一次菜单。
     * 菜单的**内容**仍然由画布这边拼（只有它拿得到解释器），面板只负责说
     * 「给这几个对象弹菜单，弹在这个页面坐标」。
     *
     * 为什么要有这条入口：画布上对象重叠时，点到的永远是最上面那个，
     * 想选的目标很容易被挡住；从列表里右键不存在这个问题 —— 名字是确定的。
     */
    objectMenuRequest?: { id: number; names: string[]; x: number; y: number } | null;
    /**
     * 把主画布元素交给上层。
     *
     * 「编辑对象」对话框要在左边显示当前图形，做法和作图对话框一样：直接 drawImage
     * 复制主画布的像素（不重跑脚本，随机点不会跳、动画不会重启）。
     * 画布元素只有这里持有，所以往上报一次。
     */
    onCanvasReady?: (canvas: HTMLCanvasElement | null) => void;
    /**
     * 「重播延时动画」令牌：上层在用户主动重新运行脚本（点 Execute / 撤销）时 +1。
     * 只有它变了才让 `ANIMATE` 的延时动画从头放一遍；没变的重绘（选中 / 拖动 / 改属性 /
     * 改窗口大小）走「续播」，从上次的断点接着放，不会重来也不会直接跳到结尾。
     */
    animationToken: number;
    script: string;
    revision: number;
    onGeometryMessage: (level: string, line: number, message: string) => void;
    onClearMessage: () => void;
    frozenRandomVariables: Record<string, number>;
    frozenRandomObjects: Record<string, { x: number; y: number }>;
    selectedObjectNames: string[];
    selectedLabelId: string | null;
    labelPositions: Record<string, IPoint>;
    onSelectObject: (name: string | null, additive?: boolean) => void;
    onSelectLabel: (id: string | null) => void;
    onLabelPositionChange: (id: string, position: IPoint) => void;
    onObjectPropertyChange: (name: string, changes: Partial<Record<ObjectPropertyKey, number>>, options?: PropertySyncOptions) => void;
    /** 标签：整串文本写回 `label=`；空串表示不显示标签。和属性面板共用同一个入口。 */
    onLabelChange: (name: string, value: string, lineNumber?: number) => void;
    /** 右键作图生成的 DSL 指令行，由上层追加到脚本末尾并重新执行。 */
    onGeometryCommands: (commands: string[]) => void;
    /**
     * 删除对象。改写脚本而不是追加指令，所以把「解释器的顶层指令表快照」一起交上去 ——
     * 只有它知道哪一行定义了谁、哪一行引用了谁，而上层拿不到解释器实例。
     */
    onDeleteObjects: (names: string[], commands: ReadonlyArray<TopLevelCommandInfo>) => void;
    /**
     * 改写一条 TEXT 指令行（编辑文字）。TEXT 没有 `name=`，只能按行号定位，
     * 所以行号由画布在右键那一刻从解释器取好一起传上去。
     */
    onTextLineChange: (lineNumber: number, spec: CreateTextSpec) => void;
    /** 删除一条 TEXT 指令行。同上，按行号定位。 */
    onDeleteText: (lineNumber: number) => void;
    /** 把线性对象的某一段加入 `cutPoints`，由原对象自行停止/跳过绘制。 */
    onLinearTrim: (rewrite: LinearTrimRewrite, commands: ReadonlyArray<TopLevelCommandInfo>) => void;
    /**
     * 正在为哪个对象挑截止点；null 表示不在挑选中。
     * `sign` 决定新截止点砍哪一侧：`+` 砍正方向一侧，`-` 砍负方向一侧。
     */
    cutPointPick: CutPointPickRequest | null;
    /** 用户在画布上点中了一个点，把它作为截止点加进去。 */
    onCutPointPicked: (pointName: string) => void;
    onCancelCutPointPick: () => void;
    onVariablesChange: (variables: VariableInfo[]) => void;
}

export interface CutPointPickRequest {
    objectName: string;
    sign: '+' | '-';
}

const GeometryCanvas: React.FC<GeometryCanvasProps> = ({ width, height, isFullscreen, onToggleFullscreen, onExecute, onRequestObjectEdit, objectMenuRequest, onCanvasReady, animationToken, script, revision, onGeometryMessage, onClearMessage, frozenRandomVariables, frozenRandomObjects, selectedObjectNames, selectedLabelId, labelPositions, onSelectObject, onSelectLabel, onLabelPositionChange, onObjectPropertyChange, onLabelChange, onGeometryCommands, onDeleteObjects, onTextLineChange, onDeleteText, onLinearTrim, cutPointPick, onCutPointPicked, onCancelCutPointPick, onVariablesChange }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const interpreterRef = useRef<GeometryDSLInterpreter | null>(null);
    /**
     * 上一次执行脚本时的 (脚本, animationToken) 快照，用来判断这次重绘该不该播放延时动画。
     * 见 redraw 里的说明。
     */
    /**
     * 上一次执行脚本时的 (脚本, animationToken) 快照，用来判断这次重绘该不该播放延时动画。
     *
     * 置为 `null` 表示「强制当成一次用户主动重跑」—— 单步按钮靠它把同一份脚本重新装填一轮，
     * 见 handleStepDraw。
     */
    const lastAnimationRunRef = useRef<{ script: string; token: number } | null>(null);

    /**
     * 下一次「用户主动重跑」该用什么姿态起播：
     *   - `'play'`（默认）：从头播一遍，正常动画；
     *   - `'hold'`：从头**装填**这一轮的绘制队列，但停在第一项之前不画。
     *     单步按钮用它来「重新装填一轮，然后由我一下一下推」。
     */
    const restartIntentRef = useRef<'play' | 'hold'>('play');

    /**
     * 「这一轮装填完，立刻往前推一步」。
     *
     * 单步按钮需要「重跑脚本 + 只画一项」，但重跑要走 `onExecute`（上层 state 更新 →
     * effect → redraw 的**异步**路径），没法在调用点同步接着 step。所以把意图挂在这里，
     * 由 redraw 在 `execute` 之后兑现。
     */
    const pendingStepRef = useRef(false);

    // 使用 Ref 来存储变换和拖动状态，避免不必要的组件重渲染。
    // rotation 只装**交互式**那一层；脚本里 `VIEW rotation=` 声明的角度由解释器叠加，
    // 所以「重置视图」清掉它之后，脚本声明的角度依然生效。
    const transformRef = useRef<CanvasView>(createView());
    const isDraggingRef = useRef(false);
    const lastCanvasPositionRef = useRef({ x: 0, y: 0 });
    const pointerDownPositionRef = useRef({ x: 0, y: 0 });
    const hasDraggedRef = useRef(false);
    const isLockedRef = useRef(false);
    const activeSelectionRef = useRef<CanvasSelection>(null);
    /**
     * 「这次点击里，mousedown 阶段已经为这个对象发过 onSelectObject」标记。
     *
     * 浏览器对一次普通点击会同时触发 mousedown 和 click 两个事件，两个 handler
     **都会** 调 onSelectObject。结果就是 ctrl+click 看起来是一次点击，实际上
     * 触发了**两次** toggle（add 再 remove），等于啥都没干 —— 「选择三个点做
     * 三角形」这种多选就完全选不起来。
     *
     * 这里用一个 ref 把「mousedown 刚选定过」记下来，click handler 看见同一次手势
     * 里已经选过同一个对象就直接跳过。drag 抑制（suppressClick）走另一条路，不冲突。
     * mouseup 时清掉，下一次点击重新开始。
     */
    const selectCommittedByMousedownRef = useRef<string | null>(null);
    const labelDragOffsetRef = useRef({ x: 0, y: 0 });
    const isLabelDraggingRef = useRef(false);
    const objectDragOffsetRef = useRef({ x: 0, y: 0 });
    const isObjectDraggingRef = useRef(false);
    const draggedObjectNameRef = useRef<string | null>(null);
    /**
     * 这一次拖动实际改的是哪个属性。
     *
     * 普通的点改的是 x / y；**线上点 / 圆上点**改的是 `distance` / `angle`
     * （它们被约束在对象上，写 x / y 会把点从线上拽下来）。
     * 拖的过程中每帧都要算一次，鼠标松开时再按这里记的键写回脚本，
     * 所以存成 ref —— 事件处理函数挂在 effect 里，只有 ref 能读到最新值。
     */
    const draggedPropertyRef = useRef<{ key: ObjectPropertyKey; value: number } | null>(null);
    const suppressClickRef = useRef(false);
    // 「截取线段」的选择会话。用 ref 是为了让画布事件处理函数和 redraw 都读到最新值，
    // state 只负责驱动提示条重渲染（和 isLocked / isLockedRef 的分工一致）。
    const trimSessionRef = useRef<TrimSession | null>(null);
    const trimHoverRef = useRef<number | null>(null);
    const exitTrimModeRef = useRef<() => void>(() => {});
    const commitTrimPieceRef = useRef<(tMouse: number) => void>(() => {});
    // 「挑截止点」的会话。和截取模式同一套做法：ref 给事件处理函数读最新值，
    // state 只负责驱动提示条重渲染。
    const cutPointPickRef = useRef<CutPointPickRequest | null>(null);
    /**
     * 「旋转视图」的一次拖动会话。
     *
     * 记的是「上一帧鼠标相对画布中心的角度」，每帧只累加增量 —— 直接拿
     * `起始角` 相减的话，一旦转过 ±π 就会跳变一整圈。
     */
    const rotationDragRef = useRef<{
        /** 拖动开始时鼠标相对画布中心的角度（Shift 吸附用它做绝对定位基准）。 */
        startAngle: number;
        /** 拖动开始时的视图旋转角（弧度）。 */
        startRotation: number;
        /** 上一帧的角度，用于逐帧累加增量。 */
        lastAngle: number;
    } | null>(null);

    // 开锁：编辑、选择和拖动标签；闭锁：移动绘图区和缩放。
    // 两种状态下，空白处的拖动都用于平移视图，滚轮都用于缩放。
    // 区别只在开锁状态下：光标压在元素上时，拖动改为操作该元素，滚轮则不缩放。
    const [isLocked, setIsLocked] = useState(false);
    // 「旋转视图」模式：按钮处于选中状态时，左键拖动改为绕画布中心旋转整个视图。
    // 和闭锁一样是一个模式开关，ref 给事件处理函数读最新值、state 只驱动按钮和提示条。
    const [isRotating, setIsRotating] = useState(false);
    const isRotatingRef = useRef(false);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    // 当前展开的二级菜单（存父项的 id）。用 state 而不是纯 CSS `:hover`：
    // 展开位置要按菜单是否贴近右边缘左右翻转，只有 JS 知道那个位置。
    const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null);
    // 截取模式：session 非空时画布进入「选一段」状态，hover 记录光标当前压在第几段上。
    const [trimSession, setTrimSession] = useState<TrimSession | null>(null);
    const [trimHover, setTrimHover] = useState<number | null>(null);
    // 「两线成角」模式：session 非空时画布进入「选一个角」状态，
    // hover 记录鼠标当前落在四个角里的哪一个（下标），null = 还没压到任何角上。
    const [angleSession, setAngleSession] = useState<AnglePickGeometry | null>(null);
    const [angleHover, setAngleHover] = useState<number | null>(null);
    const angleSessionRef = useRef<AnglePickGeometry | null>(null);
    const angleHoverRef = useRef<number | null>(null);
    const exitAngleModeRef = useRef<() => void>(() => {});
    const commitAngleRef = useRef<(sectorIndex: number) => void>(() => {});
    // 作图对话框（点操作与线操作共用）。打开时把当前画布像素复制一份当底图，
    // 用户在里面点选目标对象或填写参数。
    const [pickDialog, setPickDialog] = useState<PickDialogState | null>(null);
    // 「修改标签」对话框。内容和目标行号都在右键那一刻从解释器取好 ——
    // 对话框本身不持有解释器，也就不可能在脚本重跑后拿着过期的行号去写。
    const [labelDialog, setLabelDialog] = useState<LabelDialogState | null>(null);
    // 「插入文字 / 编辑文字」对话框。右键处坐标在点菜单那一刻记下来 —— 对话框里的预览和
    // 最终生成的 TEXT 指令都以此为准，不可能被期间画布的缩放/平移带跑偏。
    //
    // `editLine` 非空表示这是**编辑**已有文字：提交时改写那一行而不是追加新指令。
    // 行号同样在右键那一刻定格，避免脚本在对话框打开期间被改后写错行。
    const [textDialog, setTextDialog] = useState<{
        anchor: Point2D;
        value: CreateTextSpec;
        editLine?: number;
        /** 编辑模式下用于生成预览指令的「原行文本」（只读，提交时被新值覆盖）。 */
        sourceLine?: string;
    } | null>(null);
    // KaTeX 异步缓存命中后会通过订阅通知这里，每次通知都让 redraw 重新执行
    // 一次脚本，把缓存好的 LaTeX 离屏 canvas 贴回主画布。
    const [katexTick, setKatexTick] = useState(0);
    const redrawRef = useRef<() => void>(() => {});

    // 「暂停播放」开关。暂停的是**动画推进**（`ANIMATE` 的延时作图 + `CREATE ANIMATION`
    // 的逐帧播放），画布上已经画出来的内容原样留着，随时可以继续。
    //
    // state 和 ref 各存一份（和 isLocked / isLockedRef 同一套分工）：state 驱动按钮图标，
    // ref 给 redraw 读 —— redraw 里不能用 state，否则把它写进依赖数组后，
    // 每次点暂停都会重跑一遍脚本（等于把动画重置），正好和「暂停」要的效果相反。
    const [isPaused, setIsPaused] = useState(false);
    const isPausedRef = useRef(false);
    // 工具栏是否收成一个按钮。收起后画布上只留一个小小的「…」，
    // 需要时再点开 —— 全屏作图时不想让工具栏挡住图。
    const [isToolbarCollapsed, setIsToolbarCollapsed] = useState(false);
    // 「此刻有没有动画在推进」。解释器不会主动通知，靠定时轮询拿；
    // setState 传相同值时 React 会跳过重渲染，所以这个轮询几乎不产生开销。
    // 只用来决定「暂停」按钮要不要置灰。
    const [hasActiveAnimation, setHasActiveAnimation] = useState(false);
    // 单步的进度提示（`3 / 7`），显示在按钮的悬停提示里。
    // 存成**字符串**而不是 `{drawn,total}` 对象：轮询每 400ms 跑一次，
    // 每次都 new 一个对象的话 setState 永远判定为「变了」，白白重渲染。
    const [stepProgressLabel, setStepProgressLabel] = useState('');

    // 使用 useCallback 封装重绘逻辑，以便在多个 Effect 中稳定引用
    const redraw = useCallback(() => {
        const canvas = canvasRef.current;
        const interpreter = interpreterRef.current;
        if (!canvas || !interpreter) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // 1. 重置变换矩阵，清空画布
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 2. 视图矩阵（平移/缩放/旋转）由解释器在执行脚本前自己写进 ctx —— 总旋转角要
        //    同时叠加 `VIEW rotation=` 和这里的交互式旋转，只有解释器两边都知道。
        //    见 DSLInterpreter.applyCanvasViewTransform。

        // 3. 重新执行脚本进行绘制
        try {
            // 更新变换信息到DSL引擎
            interpreter.setTransform(canvas, transformRef.current);
            interpreter.setFrozenRandomVariables(frozenRandomVariables);
            interpreter.setFrozenRandomObjects(frozenRandomObjects);
            interpreter.setSelectedObjectNames(selectedObjectNames);
            interpreter.setSelectedLabelId(selectedLabelId);
            interpreter.setLabelPositions(labelPositions);
            // 清空输出消息
            onClearMessage();
            // 延时动画（`ANIMATE`）只在「用户主动重新运行脚本」时从头放一遍。
            // 选中对象、拖动点、改属性、改窗口大小、KaTeX 异步缓存命中都会走到这里重绘，
            // 那些不该重放动画 —— 否则点一下对象整幅图就重新一个一个地画，根本没法交互。
            // 判据是 animationToken 有没有变：令牌由上层在点 Execute / 撤销时 +1。
            // 令牌没变的重绘走「续播」：解释器会把已经画过的部分补回来，再从断点接着放。
            const previousRun = lastAnimationRunRef.current;
            const restartAnimation = previousRun === null || previousRun.token !== animationToken;
            lastAnimationRunRef.current = { script, token: animationToken };
            if (restartAnimation) {
                if (restartIntentRef.current === 'hold') {
                    // 单步：从头装填，但停在第一项之前不画。
                    // 只有暂停态下 `startDelayedDrawPlayback` 才会扣住，所以这里要保证是暂停的。
                    if (!isPausedRef.current) {
                        isPausedRef.current = true;
                        setIsPaused(true);
                        interpreter.pauseAnimations();
                    }
                } else if (isPausedRef.current) {
                    // 「重新运行脚本」= 从头播一遍，顺手把暂停解掉。
                    // 必须**先**恢复再 execute：解释器在暂停态下会把延时绘制的队列原地扣住
                    // （见 startDelayedDrawPlayback 的暂停分支），先 execute 的话这一轮什么都画不出来。
                    isPausedRef.current = false;
                    setIsPaused(false);
                    interpreter.resumeAnimations();
                }
            }
            // 姿态是一次性的：用完立刻复位，别影响下一次重绘。
            restartIntentRef.current = 'play';
            // 重新执行脚本
            interpreter.execute(script, { restartAnimation });
            // 「重跑完只画一项」——单步按钮挂的意图，在这里兑现。
            // 必须排在 execute 之后：execute 里队列才装填好（而且是 hold 住的）。
            if (pendingStepRef.current) {
                pendingStepRef.current = false;
                interpreter.step();
            }
            onVariablesChange(interpreter.getVariables());

            // 派生部件（多边形的边、矩形自动补出来的角）没有自己的绘制项 ——
            // 多边形画的是一整条轮廓，边只是挂在它下面「可引用、可命中」的对象。
            // 于是选中一条边时画布上一点变化都没有（连多边形的整体高亮都会退掉），
            // 用户会以为根本点不中。这里补一遍：选中了、但这一轮没被正常画出来的对象，
            // 用同一套高亮描出来。普通对象不走这条路 —— 它们在上面的绘制里已经高亮过了。
            for (const name of selectedObjectNames) {
                if (!interpreter.isObjectRendered(name)) {
                    interpreter.drawObjectHighlight(ctx, name, transformRef.current);
                }
            }

            // 截取预览：把光标压着的那一段用虚线描出来。
            // 必须画在 execute 之后 —— 画布在这之前刚被清空重绘。
            const session = trimSessionRef.current;
            const hoverIndex = trimHoverRef.current;
            if (session && hoverIndex !== null) {
                const piece = session.pieces[hoverIndex];
                if (piece) {
                    interpreter.drawLinearPortionHighlight(
                        ctx,
                        session.anchorName,
                        transformRef.current,
                        { startT: piece.startT, endT: piece.endT },
                    );
                }
            }

            // 「两线成角」预览：把夹出鼠标所在那个角的两条射线描出来。
            // 第 i 个角由 rays[i] 逆时针转到 rays[(i + 1) % 4]，正好就是这两条。
            const angleSessionNow = angleSessionRef.current;
            const angleSector = angleHoverRef.current;
            if (angleSessionNow && angleSector !== null) {
                const sector = angleSessionNow.sectors[angleSector];
                if (sector) {
                    for (const offset of [0, 1]) {
                        const ray = angleSessionNow.rays[(sector.startRay + offset) % angleSessionNow.rays.length];
                        interpreter.drawLinearPortionHighlight(
                            ctx,
                            ray.line,
                            transformRef.current,
                            { startT: ray.startT, endT: ray.endT },
                            { color: ANGLE_RAY_HIGHLIGHT_COLOR },
                        );
                    }
                }
            }
        } catch (error) {
            console.error("Error during redraw:", error);
        }
    }, [script, animationToken, frozenRandomVariables, frozenRandomObjects, selectedObjectNames, selectedLabelId, labelPositions, onVariablesChange, katexTick]); // 选中对象、标签位置或固定状态变化时重绘

    // 保持最新 redraw 的引用，给 KaTeX 订阅回调调用，避免闭包过期
    useEffect(() => {
        redrawRef.current = redraw;
    }, [redraw]);

    // 订阅 KaTeX 异步缓存完成事件：缓存命中后再次重绘，把 LaTeX 贴回画布
    useEffect(() => {
        const unsubscribe = subscribeKatexUpdates(() => {
            setKatexTick((tick) => tick + 1);
        });
        return unsubscribe;
    }, []);

    // Effect for initializing the interpreter
    useEffect(() => {
        if (!interpreterRef.current && canvasRef.current) {
            interpreterRef.current = new GeometryDSLInterpreter(canvasRef.current, onGeometryMessage);
        }
    }, [onGeometryMessage]);

    // 卸载时停掉动画的 rAF 驱动循环。
    // 单独一个 effect（依赖为空）而不是挂在上面的初始化 effect 上：
    // 后者依赖 onGeometryMessage，回调换一次身份就会重跑 cleanup，
    // 那样会把正在播放的动画误停，而且不会自动重启。
    useEffect(() => () => {
        interpreterRef.current?.dispose();
    }, []);

    // 把画布元素报给上层：「编辑对象」对话框要复制它的像素当图形预览。
    // 卸载时报 null，免得上层留着一个已经脱离文档的元素。
    useEffect(() => {
        onCanvasReady?.(canvasRef.current);
        return () => onCanvasReady?.(null);
    }, [onCanvasReady]);

    // Effect for redrawing when external props change
    useEffect(() => {
        if (interpreterRef.current && canvasRef.current) {
            interpreterRef.current.setCanvas(canvasRef.current);
            redraw();
        }
    }, [width, height, script, revision, redraw]);

    // 生成代码时用来避重名的上下文：脚本里出现过的名字，加上解释器里实际存在的对象名。
    // 只扫脚本文本是不够的——`CREATE INTERSECT name=A,B ...` 一条指令就能建出两个对象。
    // getLinearEndpoints 供等分点/延长/截取/中垂线引用主体自己的定义点，保证新图形能跟着原图形动。
    // getLinearEndpointCoords 多给一份坐标，供「在线上取点」和「裁剪」把鼠标位置投影到线上。
    // 定义在右键菜单的 effect 之前：菜单要用它判断「裁剪」能不能点（退化时要置灰 + 说明原因）。
    const buildContext = useCallback((): CommandBuildContext => {
        const interpreter = interpreterRef.current;
        return {
            script,
            objectNames: interpreter ? Array.from(interpreter.getAllObjects().keys()) : [],
            getLinearEndpoints: name => interpreter?.getLinearEndpointNames(name) ?? null,
            getLinearEndpointCoords: name => interpreter?.getLinearEndpointCoords(name) ?? null,
            // 点坐标只用于「三点是否共线」的判定 —— 共线时三角形 / 外接圆 / 内切圆做不出来。
            getPointCoords: name => interpreter?.getPointCoords(name) ?? null,
            getPointsOnLinear: name => interpreter?.getPointsOnLinear(name) ?? null,
            // 圆的圆心 / 半径：圆操作（最近点 / 圆心 / 切线 / 法线）要先知道圆心才能算角度。
            getCircleInfo: name => interpreter?.getCircleInfo(name) ?? null,
            // 全部点的坐标：两圆求交点时先看交点里是否已经有点存在，有则只补建另一个。
            listPointCoords: () => interpreter?.getAllPointCoords() ?? [],
            // 有源码行的点才是脚本里真实存在的点。派生线的定义点是 `L_pb_<mid>` 这类
            // 内部合成点，写进 cutPoints= 就是一处悬空引用，所以排除掉。
            // 多边形的派生顶点（`sq_v2` 这类自动补的角）虽然也没有自己的定义行，
            // 但名字是「父名 + 固定后缀」，重跑照样建得出来，所以算可引用 ——
            // 不认它们的话，「在矩形的某条边上作中垂线」就做不了。
            isReferenceablePoint: name => interpreter?.isReferenceableObjectName(name) === true,
        };
    }, [script]);

    /**
     * 按「一批已选中的对象名 + 一个落点」拼出对象菜单。
     *
     * 抽出来是因为它有两个调用方：画布上右键（落点来自鼠标位置），
     * 以及**变量表里右键**（落点用对象自己的位置算）。两处必须给出同一个菜单 ——
     * 否则「从列表里选就不会被画布上的对象挡住」只解决了一半，菜单内容还不一样。
     *
     * 返回 null 表示这批对象拼不出菜单（对象表里一个都查不到）。
     */
    const buildObjectMenu = useCallback((objectNames: string[], anchorPoint: Point2D | null, creationSize: number): Omit<ContextMenuState, 'x' | 'y'> | null => {
        const interpreter = interpreterRef.current;
        if (!interpreter) return null;
        const objects: ObjectRef[] = objectNames
            .map(name => {
                const object = interpreter.getObject(name);
                return object ? { name: object.name, type: object.type } : null;
            })
            .filter((item): item is ObjectRef => item !== null);

        const items: ContextMenuItem[] = [];
        /**
         * 「作图」类操作先收在这里，最后统一包成一个 `作图 ▸` 二级菜单。
         *
         * 一个点能作的图有六种、一个三角形有九种，全铺在顶层会把「编辑 / 标签 / 删除」
         * 这些真正跟对象本身有关的项挤到看不见的地方（三点选中时菜单能长到十几行）。
         * 分组之后顶层稳定在三四项，找什么都是「先看是不是要作图」。
         */
        const drawingItems: ContextMenuItem[] = [];
        let title = `${objects.length} 个对象`;

        // 解释器解析好的顶层指令表：判断「能不能删/能不能裁」要用它，
        // 点下去时也把它一起交给上层做脚本改写（上层没有解释器实例）。
        const commands = interpreter.getTopLevelCommands();

        if (objects.length === 1) {
            // 单个对象：菜单内容由「这个类型支持哪些作图」决定。
            // 这些操作都需要先弹对话框（再点一个目标或填参数），所以不是直接作图。
            const [anchor] = objects;
            // 标题写清是哪个对象 —— 「1 个对象」这种话等于没说，用户看不出自己点中了什么。
            title = anchor.type === 'point' ? `点 ${anchor.name}` : anchor.name;
            // 「编辑对象…」排在最前面：右键一个对象最直接的诉求就是看看它、改改它，
            // 而不是每次都从右侧面板里翻。多选时不出现 —— 「编辑哪一个」没有答案。
            items.push({
                id: 'editObject',
                label: '编辑…',
                title: '打开对话框修改它的坐标 / 半径 / 标签 / 截止点，也可以冻结',
                editObject: true,
            });
            const operations = getPickOperationsForAnchor(anchor.type);
            if (operations.length > 0) {
                drawingItems.push(...operations.map(operation => ({
                    id: operation,
                    label: PICK_OPERATION_LABELS[operation],
                    pickOperation: operation,
                })));
            }

            // 一个三角形：直接对它作外接圆 / 内切圆 / 各种心（生成 `tri=<名字>`），
            // 不用让用户把三个顶点再点一遍。
            if (anchor.type === 'triangle') {
                for (const [id, label, hint] of TRIANGLE_MENU_ITEMS) {
                    if (!TRIANGLE_OBJECT_OPERATIONS.includes(id)) continue;
                    const plan = planSelectionOperation(id, objects, buildContext());
                    drawingItems.push({
                        id,
                        label,
                        title: plan.blocked ?? hint,
                        selectionOperation: id,
                        disabled: Boolean(plan.blocked),
                    });
                }
            }

            // 截取：进入选择模式，鼠标在线上移动时高亮光标所在的那一段，单击删掉它。
            // 段的分界全部来自线上已有的点，所以生成的对象能随原图形一起变化。
            // 能切出几段是算出来的，一段都切不出来（比如线段上还没取点）就置灰说明原因。
            // 直线/射线两端的无限延伸部分也是可点的「段」（标签写作 `−∞ → A` / `B → +∞`），
            // 点一下就整条删掉 —— 想「把直线截成线段」就依次点掉两条尾巴。
            if (isLinearType(anchor.type)) {
                const pieceSet = listLinearPieces(
                    { anchorName: anchor.name, anchorType: anchor.type },
                    buildContext(),
                );
                const hasUnbounded = pieceSet.pieces.some(
                    piece => piece.startName === null || piece.endName === null,
                );
                // 截取改的是对象自己的 `cutPoints=`，得有一条定义行才写得回去。
                // 多边形派生出来的边（`sq_e1` 之类）在脚本里没有定义行，
                // 与其让它点下去毫无反应，不如直接置灰说清楚原因。
                const trimOwner = interpreter.getDerivedPartOwner(anchor.name);
                const trimBlocked = pieceSet.blocked
                    ?? (trimOwner
                        ? `${anchor.name} 是由 ${trimOwner} 派生出来的边，脚本里没有它的定义行，截取无处写回`
                        : undefined);
                drawingItems.push({
                    id: 'trim',
                    label: hasUnbounded ? '截取线段（含两端无限延伸部分）' : '截取线段（选要删除的一段）',
                    title: trimBlocked,
                    trimMode: true,
                    disabled: Boolean(trimBlocked),
                });
            }

            // 改标签：名字是给引用用的标识符（自动生成的还是 `perp1` 这种），
            // 想让它出现在图上就显式设一个标签。
            //
            // 解释器现在对**所有**已注册对象都返回一条记录（editable 恒为 true）：
            // 有可挂的 `label=` 就改那一行，没有的地方（`CREATE TANGENT` 顺带建出的
            // `T2` / `T2_tan` 之类）就用 SETLABEL 指令兜底。所以这里不再需要置灰。
            const labelProperty = interpreter.getEditableLabel(anchor.name);
            if (labelProperty) {
                items.push({
                    id: 'editLabel',
                    label: '标签…',
                    title: labelProperty.editable
                        ? '设置显示在画布上的标签文字（留空 = 不显示）'
                        : labelProperty.reason,
                    editLabel: true,
                    disabled: !labelProperty.editable,
                });
            }

            // 选中一段文字：编辑内容与样式 / 删除。
            //
            // 单独开一条分支而不是走通用的「改标签 + 删除」，原因是 TEXT 在两个
            // 通用路径里都不可见：它没有 `name=`，所以既挂不上 `label=`（改标签无从谈起），
            // 也进不了 `definedNamesOf`（通用删除找不到要删的定义行）。
            // 唯一可靠的定位是**行号**，由解释器给出。
            if (anchor.type === 'text') {
                const textInfo = interpreter.getEditableText(anchor.name);
                if (textInfo) {
                    items.push({
                        id: 'editText',
                        label: '文字内容…',
                        title: textInfo.editable
                            ? '修改内容与样式，保存后写回脚本里这条 TEXT 指令'
                            : textInfo.reason,
                        editText: { lineNumber: textInfo.lineNumber },
                        disabled: !textInfo.editable,
                    });
                    // 删除放在这里而不是沿用页面底部的通用「删除」：通用那条对 TEXT
                    // 必然置灰，留着会让用户以为「文字删不掉」。
                    items.push({
                        id: 'deleteText',
                        label: '删除',
                        title: '删除脚本里这条 TEXT 指令',
                        deleteTextLine: textInfo.lineNumber,
                        disabled: !textInfo.editable,
                    });
                }
            }

            // 选中一个圆：圆周最近点 / 圆心 / 切线 / 法线。都即时生成，不需要对话框。
            if (anchor.type === 'circle') {
                for (const [id, label, hint] of [
                    ['pointOnCircle', '圆周取点', '在圆周上离右键处最近的位置生成一点'],
                    ['circleCenter', '圆心', '生成这个圆的圆心点'],
                    ['tangent', '切线（最近点）', '过圆周上离鼠标最近的点作圆的切线'],
                    ['normal', '法线（最近点）', '过圆周上离鼠标最近的点作法线（即过圆心与该点的直线）'],
                ] as const) {
                    const plan = planCircleOperation(id, anchor, anchorPoint, buildContext());
                    drawingItems.push({
                        id,
                        label,
                        title: plan.blocked ?? hint,
                        circleOperation: id,
                        disabled: Boolean(plan.blocked),
                    });
                }
                // 上面那条切线的切点是「鼠标最近处」，这里再给一个显式挑点的入口：
                // 圆外一个已经画好的点 → 过它作切线。需要先弹对话框点选那个点。
                drawingItems.push({
                    id: 'tangentToCircle',
                    label: '切线（选点）…',
                    title: `点击一个已画出的点，过它作 ${anchor.name} 的切线并标出切点`,
                    pickOperation: 'tangentToCircle',
                });
            }
        } else if (objects.length === 2) {
            const [first, second] = objects;
            const circleRef = objects.find(item => item.type === 'circle');
            const pointRef = objects.find(item => isPointType(item.type));
            const lineRef = objects.find(item => isLinearType(item.type));

            if (isPointType(first.type) && isPointType(second.type)) {
                drawingItems.push(
                    { id: 'segment', label: '连成线段', selectionOperation: 'segment' },
                    { id: 'line', label: '连成直线', selectionOperation: 'line' },
                    { id: 'perpBisector', label: '垂直平分线', selectionOperation: 'perpBisector' },
                    {
                        id: 'circleWithDiameter',
                        label: '以两点作圆（直径）',
                        title: '圆心是两点的中点，半径是两点距离的一半；拖动任一点圆会跟着变',
                        selectionOperation: 'circleWithDiameter',
                    },
                );
            } else if (pointRef && circleRef) {
                // 一个点 + 一个圆：过该点作圆的切线（并标出切点）。
                // 点在圆内时做不出来，置灰并说明原因。
                const plan = planSelectionOperation('pointCircleTangent', objects, buildContext());
                const count = plan.newPointCount ?? 0;
                drawingItems.push({
                    id: 'pointCircleTangent',
                    label: count === 1
                        ? '切线（切点就在该点上）'
                        : '切线（作两条，标出切点）',
                    title: plan.blocked ?? '过这个点作圆的切线；点在圆外会作出两条切线并标出两个切点',
                    selectionOperation: 'pointCircleTangent',
                    disabled: Boolean(plan.blocked),
                });
            } else if (lineRef && circleRef) {
                // 一条线 + 一个圆：求交点。最多两个；已有的交点不再重复建。
                const plan = planSelectionOperation('lineCircleIntersect', objects, buildContext());
                const count = plan.newPointCount ?? 0;
                const defaultHint = count === 1
                    ? '线与圆有两个交点，但其中一个已经存在，只创建缺少的那个点'
                    : '创建这条线与圆的全部交点';
                drawingItems.push({
                    id: 'lineCircleIntersect',
                    label: count === 1 ? '交点（补建 1 个点）' : '交点',
                    title: plan.blocked ?? defaultHint,
                    selectionOperation: 'lineCircleIntersect',
                    disabled: Boolean(plan.blocked),
                });
            } else if (
                (isPointType(first.type) && isLinearType(second.type))
                || (isLinearType(first.type) && isPointType(second.type))
            ) {
                drawingItems.push({ id: 'perpendicular', label: '垂线', selectionOperation: 'perpendicular' });
            } else if (isLinearType(first.type) && isLinearType(second.type)) {
                // 两条线选中时最常见的诉求就是求交点，直接给出来。
                drawingItems.push({ id: 'intersect', label: '交点', selectionOperation: 'intersect' });
                // 角平分线 / 平行四边形都要求两条线共端点，所以共用同一个判定：
                // 共不了端点时置灰并把原因写在悬停提示里（比如「两条线没有公共端点」）。
                for (const [id, label] of [
                    ['angleBisector', '角平分线（第一条 → 第二条）'],
                    ['parallelogram', '平行四边形'],
                ] as const) {
                    const plan = planSelectionOperation(id, objects, buildContext());
                    drawingItems.push({
                        id,
                        label,
                        title: plan.blocked ?? (id === 'angleBisector'
                            ? '从第一条线转向第二条线的方向作角平分线'
                            : '以公共端点为顶点、这两条边为邻边补全平行四边形'),
                        selectionOperation: id,
                        disabled: Boolean(plan.blocked),
                    });
                }
                // 作角：两条线夹出四个角，作哪一个由鼠标决定，所以点下去是进入选择模式
                // 而不是直接出图。同样要求共端点（不共端点定不出顶点），
                // 判定与角平分线共用，不共端点时置灰并写明原因。
                const anglePlan = planSelectionOperation('createAngle', objects, buildContext());
                drawingItems.push({
                    id: 'createAngle',
                    label: '作角（鼠标选）',
                    title: anglePlan.blocked ?? '鼠标移到哪个角里，夹出它的两条射线就变色，单击确认',
                    anglePick: true,
                    disabled: Boolean(anglePlan.blocked),
                });
            } else if (first.type === 'circle' && second.type === 'circle') {
                // 两个圆：求交点。最多两个交点；若其中一个已经有点落在上面，只补建另一个。
                const plan = planSelectionOperation('circleIntersect', objects, buildContext());
                const count = plan.newPointCount ?? 0;
                const defaultHint = count === 1
                    ? '两圆有两个交点，但其中一个已经存在，只创建缺少的那个点'
                    : count === 2
                        ? '创建两圆的全部两个交点'
                        : '创建两圆的交点';
                drawingItems.push({
                    id: 'circleIntersect',
                    label: count === 1 ? '交点（补建 1 个点）' : '交点',
                    title: plan.blocked ?? defaultHint,
                    selectionOperation: 'circleIntersect',
                    disabled: Boolean(plan.blocked),
                });

                // 两圆的公切线：内公切线与外公切线各给一项。
                // 切点与切线都是靠表达式动态定出来的（拖动圆会自动跟随），
                // 所以这里只按可行性置灰，不需要像求交点那样预告建几个点。
                for (const [id, label, hint] of [
                    ['commonExternalTangent', '外公切线', '两条外公切线（两圆在同侧相切）'],
                    ['commonInternalTangent', '内公切线', '两条内公切线（两圆在异侧相切）'],
                ] as const) {
                    const tangentPlan = planSelectionOperation(id, objects, buildContext());
                    drawingItems.push({
                        id,
                        label,
                        title: tangentPlan.blocked ?? hint,
                        selectionOperation: id,
                        disabled: Boolean(tangentPlan.blocked),
                    });
                }
            }
        } else if (objects.length === 3 && objects.every(item => isPointType(item.type))) {
            // 三个点：作三角形，以及三角形的圆与各个心。
            // 三点共线时这些全都退化，置灰并说明原因，别让用户点下去得到一个看不见的结果。
            for (const [id, label, hint] of TRIANGLE_MENU_ITEMS) {
                const plan = planSelectionOperation(id, objects, buildContext());
                drawingItems.push({
                    id,
                    label,
                    title: plan.blocked ?? hint,
                    selectionOperation: id,
                    disabled: Boolean(plan.blocked),
                });
            }
        }

        // 把这一轮收集到的作图项包成一个二级菜单。
        // 插在「编辑…」之后（单对象才有那一项）、「标签 / 文字 / 删除」之前 ——
        // 顶层顺序固定成「先改对象本身，再作图，最后是标签与删除」。
        // 一项作图都没有就不插：不该留一个空的分组（比如两个文字对象之间没有任何操作）。
        const drawingGroup = groupDrawingItems(drawingItems);
        if (drawingGroup) {
            const insertAt = items[0]?.id === 'editObject' ? 1 : 0;
            items.splice(insertAt, 0, drawingGroup);
        }

        // 删除：任何几何对象都能删，所以放在最后。
        // 依赖者会被连带删掉（删掉 A 之后 `p1=A` 的定义就全废了），
        // 数量直接写在菜单上，别让用户点下去才发现删多了。
        //
        // TEXT 除外：它没有 `name=`，`planObjectDeletion` 必然返回「找不到创建指令」，
        // 列出来只会是一个永远置灰的「删除（不可用）」。文字的删除已经在上面的
        // 单对象分支里给了专用入口。
        if (objects.length > 0 && objects.some(item => item.type !== 'text')) {
            const deletableNames = objectNames.filter(name => {
                const ref = objects.find(item => item.name === name);
                return ref?.type !== 'text';
            });
            const deletion = planObjectDeletion(commands, deletableNames);
            const dependents = deletion.names.length - deletableNames.length;
            const label = deletion.blocked
                ? '删除（不可用）'
                : dependents > 0
                    ? `删除 ${deletableNames.length} 个对象（含 ${dependents} 个依赖对象）`
                    : objects.length === 1
                        ? `删除 ${objects[0].name}`
                        : `删除 ${deletableNames.length} 个对象`;
            items.push({
                id: 'delete',
                label,
                title: deletion.blocked,
                deleteObjects: deletion.names,
                disabled: Boolean(deletion.blocked),
            });
        }

        if (items.length === 0) {
            items.push({ id: 'none', label: `当前选择 ${objects.length} 个对象，暂无可用操作`, disabled: true });
        }

        return { title, objects, items, anchorPoint, creationSize };
    }, [buildContext]);

    /**
     * 取一个对象在画布上的「代表位置」，给面板发起的菜单当落点。
     *
     * 面板里右键没有「鼠标在画布上的位置」这个信息，但「在线上取点」需要一个落点。
     * 线性对象取中点、点取自身坐标 —— 对话框里还能拖动调整（见 GeometryPickDialog），
     * 所以这里只要给个合理初值就够了，不必纠结准不准。
     */
    const anchorPointOfObject = useCallback((name: string): Point2D | null => {
        const interpreter = interpreterRef.current;
        if (!interpreter) return null;
        const coords = interpreter.getLinearEndpointCoords(name);
        if (coords) {
            return { x: (coords.p1.x + coords.p2.x) / 2, y: (coords.p1.y + coords.p2.y) / 2 };
        }
        return interpreter.getPointCoords(name);
    }, []);

    // 面板发起的菜单请求：拼菜单、按请求里的页面坐标弹出来。
    const lastMenuRequestIdRef = useRef(0);
    useEffect(() => {
        if (!objectMenuRequest || objectMenuRequest.id === lastMenuRequestIdRef.current) return;
        lastMenuRequestIdRef.current = objectMenuRequest.id;

        const anchorPoint = objectMenuRequest.names.length === 1
            ? anchorPointOfObject(objectMenuRequest.names[0])
            : null;
        // creationSize 只有「空选右键新建图形」用得到，这里至少选中了一个对象，给 1 即可。
        const payload = buildObjectMenu(objectMenuRequest.names, anchorPoint, 1);
        setOpenSubmenuId(null);
        setContextMenu(payload ? { x: objectMenuRequest.x, y: objectMenuRequest.y, ...payload } : null);
    }, [objectMenuRequest, buildObjectMenu, anchorPointOfObject]);

    // 菜单元素本身。用来判断「点到菜单外面了没有」。
    const contextMenuRef = useRef<HTMLDivElement>(null);

    /**
     * 点到菜单外面就关掉。
     *
     * 画布自己的 mousedown 里也有几处 `setContextMenu(null)`，但那些**管不到面板** ——
     * 菜单是从变量表里弹出来的时候，用户点到面板上，画布收不到任何事件，菜单会一直挂着。
     * 用捕获阶段监听：右击画布时先关掉旧菜单，随后的 contextmenu 再弹新的，顺序正好。
     */
    useEffect(() => {
        if (!contextMenu) return;
        const handleMouseDown = (event: MouseEvent) => {
            if (contextMenuRef.current?.contains(event.target as Node)) return;
            setContextMenu(null);
        };
        window.addEventListener('mousedown', handleMouseDown, true);
        return () => window.removeEventListener('mousedown', handleMouseDown, true);
    }, [contextMenu]);

    // Effect for setting up and cleaning up event listeners
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        isLockedRef.current = isLocked;
        // 空白处现在在两种状态下都可以拖动平移视图，所以默认就是抓取光标。
        canvas.style.cursor = 'grab';

        const handleMouseDown = (e: MouseEvent) => {
            if (e.button !== 0) return;
            // 旋转模式下左键专用于旋转视图，不选择、不拖动元素。
            if (isRotatingRef.current) {
                setContextMenu(null);
                suppressClickRef.current = false;
                hasDraggedRef.current = false;
                pointerDownPositionRef.current = { x: e.clientX, y: e.clientY };
                const rotatePoint = getCanvasPoint(e);
                const canvasSize = canvas;
                const pivot = viewPivot(canvasSize.width, canvasSize.height);
                const startAngle = Math.atan2(rotatePoint.y - pivot.y, rotatePoint.x - pivot.x);
                rotationDragRef.current = {
                    startAngle,
                    startRotation: transformRef.current.rotation,
                    lastAngle: startAngle,
                };
                isDraggingRef.current = true;
                canvas.style.cursor = 'grabbing';
                return;
            }
            // 截取模式下左键专用于「选中要删除的一段」，不能同时触发选择或拖动。
            if (trimSessionRef.current) {
                setContextMenu(null);
                return;
            }
            // 「两线成角」模式下左键专用于「选中要作的那个角」，同样不触发选择或拖动。
            if (angleSessionRef.current) {
                setContextMenu(null);
                return;
            }
            // 新的一次手势开始了 —— 上一次手势里 mousedown 设的「已选」标记在此作废。
            // 注意：必须在 mouseup 之后才能清（mouseup 比 click 先到），所以这里清掉旧的、
            // 后面 mousedown 命中对象时再设新的，让 click 看得见。
            selectCommittedByMousedownRef.current = null;
            setContextMenu(null);
            pointerDownPositionRef.current = { x: e.clientX, y: e.clientY };
            lastCanvasPositionRef.current = getCanvasPoint(e);
            hasDraggedRef.current = false;
            // 每次按下都重置“抑制点击”标记，避免上一次拖动（比如在画布外松开）
            // 残留的标记把这一次的正常点击吞掉。
            suppressClickRef.current = false;
            isLabelDraggingRef.current = false;
            isObjectDraggingRef.current = false;
            draggedObjectNameRef.current = null;
            activeSelectionRef.current = null;

            if (!isLockedRef.current && interpreterRef.current) {
                const point = getCanvasPoint(e);
                activeSelectionRef.current = interpreterRef.current.hitTestSelection(
                    point.x,
                    point.y,
                    HIT_TOLERANCE,
                    transformRef.current,
                );
                // 在 mousedown 阶段就提交选择状态，让 TEXT/几何对象立即进入选中高亮，
                // 不必等到 click 事件结束；这样开始拖动时也能立刻看到红色反馈。
                if (activeSelectionRef.current?.kind === 'label') {
                    onSelectLabel(activeSelectionRef.current.id);
                    onSelectObject(null);
                    labelDragOffsetRef.current = {
                        x: point.x - activeSelectionRef.current.screenAnchor.x,
                        y: point.y - activeSelectionRef.current.screenAnchor.y,
                    };
                } else if (activeSelectionRef.current?.kind === 'object') {
                    onSelectObject(activeSelectionRef.current.name, e.ctrlKey || e.metaKey);
                    // 记下「这次手势的 click 不要再选一次」，见 selectCommittedByMousedownRef 的说明。
                    selectCommittedByMousedownRef.current = activeSelectionRef.current.name;
                    onSelectLabel(null);
                    const element = interpreterRef.current.getEditableElementPosition(activeSelectionRef.current.name);
                    // 冻结点（frozen=true）不进入拖动分支，draggedObjectNameRef 保持 null，
                    // 于是下面的 resolveCanvasDragMode 会给出 'none' —— 这次拖动不做任何事。
                    // 注意只挡拖动：点仍然会被选中，光标也不做特殊提示。
                    if (element && isDraggableElement(element)) {
                        const logicalPoint = interpreterRef.current.screenToLogicalPoint(point.x, point.y, transformRef.current);
                        if (logicalPoint) {
                            objectDragOffsetRef.current = {
                                x: logicalPoint.x - element.x,
                                y: logicalPoint.y - element.y,
                            };
                            draggedObjectNameRef.current = activeSelectionRef.current.name;
                        }
                    }
                }
            }

            // 闭锁状态：左键拖动平移视图。
            // 开锁状态：命中标签或直接定义的点时拖动该元素；没有命中任何元素时，
            // 拖动同样平移视图（与闭锁状态表现一致）。
            const dragMode = resolveCanvasDragMode(
                isLockedRef.current,
                activeSelectionRef.current,
                draggedObjectNameRef.current,
            );
            isDraggingRef.current = dragMode !== 'none';
            canvas.style.cursor = dragMode === 'pan' ? 'grabbing' : 'pointer';
        };

        const handleMouseMove = (e: MouseEvent) => {
            // 旋转模式：按住左键时按「鼠标相对画布中心的转角增量」旋转视图。
            // 按住 Shift 吸附到 15° 的整数倍，方便摆正到 30°/45°/90° 这类角度。
            if (isRotatingRef.current) {
                const drag = rotationDragRef.current;
                if (!isDraggingRef.current || !drag) {
                    canvas.style.cursor = 'grab';
                    return;
                }
                const point = getCanvasPoint(e);
                const pivot = viewPivot(canvas.width, canvas.height);
                const angle = Math.atan2(point.y - pivot.y, point.x - pivot.x);
                hasDraggedRef.current = true;
                if (e.shiftKey) {
                    // 吸附到 15° 的整数倍：用「起始角 + 起始旋转角」做绝对定位，不做增量累加。
                    // 吸附每帧都会丢掉不足一格的余量，累加的话手感会一格一格地「粘住」。
                    const swept = normalizeAngle(angle - drag.startAngle);
                    transformRef.current.rotation = snapAngle(drag.startRotation + swept);
                } else {
                    // 只累加增量：直接和起始角相减的话，转过 ±π 会跳变一整圈。
                    const delta = normalizeAngle(angle - drag.lastAngle);
                    if (delta) transformRef.current.rotation += delta;
                }
                drag.lastAngle = angle;
                redrawRef.current();
                return;
            }
            // 挑截止点模式：只提示「这个点能不能点」，不拖动也不做选择高亮。
            if (cutPointPickRef.current) {
                const pickPoint = getCanvasPoint(e);
                canvas.style.cursor = resolveCutPointHover(pickPoint.x, pickPoint.y) ? 'pointer' : 'crosshair';
                return;
            }
            // 截取模式：光标压在哪一段就高亮哪一段，不拖动也不做选择高亮。
            if (trimSessionRef.current) {
                const point = getCanvasPoint(e);
                const hover = resolveTrimHover(point.x, point.y);
                const hoverIndex = hover?.index ?? null;
                if (hoverIndex !== trimHoverRef.current) {
                    trimHoverRef.current = hoverIndex;
                    setTrimHover(hoverIndex);
                    redrawRef.current();
                }
                canvas.style.cursor = hoverIndex === null ? 'default' : 'crosshair';
                return;
            }
            // 「两线成角」模式：鼠标在哪个角里就高亮夹出那个角的两条射线。
            if (angleSessionRef.current) {
                const point = getCanvasPoint(e);
                const hover = resolveAngleHover(point.x, point.y);
                if (hover !== angleHoverRef.current) {
                    angleHoverRef.current = hover;
                    setAngleHover(hover);
                    redrawRef.current();
                }
                canvas.style.cursor = hover === null ? 'default' : 'crosshair';
                return;
            }
            if (!isDraggingRef.current) {
                if (!isLockedRef.current && interpreterRef.current) {
                    const point = getCanvasPoint(e);
                    const hoverSelection = interpreterRef.current.hitTestSelection(point.x, point.y, HIT_TOLERANCE, transformRef.current);
                    // 空白处现在也可以拖动平移视图，所以光标提示与闭锁状态一致。
                    // 冻结的点不改光标：它照样能点选，显示禁止光标会误导。
                    canvas.style.cursor = hoverSelection?.kind === 'object' ? 'pointer' : 'grab';
                }
                return;
            }
            const totalDistance = Math.hypot(
                e.clientX - pointerDownPositionRef.current.x,
                e.clientY - pointerDownPositionRef.current.y,
            );
            if (totalDistance > 4) hasDraggedRef.current = true;

            // 开锁状态下命中元素时走元素拖动；否则（没有命中任何元素）跳过这一段，
            // 和闭锁状态一样平移视图。
            const activeSelection = activeSelectionRef.current;
            const dragMode = resolveCanvasDragMode(
                isLockedRef.current,
                activeSelection,
                draggedObjectNameRef.current,
            );
            if (dragMode === 'label' || dragMode === 'object') {
                if (totalDistance <= 4 || !interpreterRef.current) return;
                const point = getCanvasPoint(e);
                if (activeSelection?.kind === 'label') {
                    const adjustedPoint = {
                        x: point.x - labelDragOffsetRef.current.x,
                        y: point.y - labelDragOffsetRef.current.y,
                    };
                    const logicalPosition = interpreterRef.current.screenToLogicalPoint(adjustedPoint.x, adjustedPoint.y, transformRef.current);
                    if (!logicalPosition) return;
                    isLabelDraggingRef.current = true;
                    onSelectLabel(activeSelection.id);
                    onLabelPositionChange(activeSelection.id, logicalPosition);
                    return;
                }
                const objectName = draggedObjectNameRef.current;
                if (activeSelection?.kind === 'object' && objectName === activeSelection.name) {
                    const logicalPosition = interpreterRef.current.screenToLogicalPoint(point.x, point.y, transformRef.current);
                    if (!logicalPosition) return;
                    const nextX = logicalPosition.x - objectDragOffsetRef.current.x;
                    const nextY = logicalPosition.y - objectDragOffsetRef.current.y;
                    // 线上点 / 圆上点：把鼠标位置换算成 `distance` / `angle` 再预览，
                    // 这样点会沿着所在的线 / 圆周滑动，而不是被拽到鼠标处（那样就脱离对象了）。
                    const constrained = interpreterRef.current.resolveConstrainedPointDrag(
                        objectName,
                        { x: nextX, y: nextY },
                    );
                    const changed = constrained
                        ? interpreterRef.current.previewObjectPropertyChange(objectName, constrained.key, constrained.value)
                        : interpreterRef.current.previewObjectPropertyChange(objectName, 'x', nextX)
                            && interpreterRef.current.previewObjectPropertyChange(objectName, 'y', nextY);
                    if (changed) {
                        draggedPropertyRef.current = constrained;
                        isObjectDraggingRef.current = true;
                        onSelectObject(objectName);
                        redrawRef.current();
                    }
                    return;
                }
                return;
            }
            // 命中了不能拖动的元素时什么都不做。
            if (dragMode === 'none') return;

            // 平移视图：闭锁状态，或开锁状态下没有命中任何元素。
            const currentCanvasPoint = getCanvasPoint(e);
            const deltaX = currentCanvasPoint.x - lastCanvasPositionRef.current.x;
            const deltaY = currentCanvasPoint.y - lastCanvasPositionRef.current.y;
            transformRef.current.x += deltaX;
            transformRef.current.y += deltaY;
            lastCanvasPositionRef.current = currentCanvasPoint;
            redraw();
        };

        const handleMouseUp = (e: MouseEvent) => {
            if (e.button !== 0) return;
            // 只要发生过真实拖动（拖动元素 / 平移 / 旋转视图），就不要再当成点击处理，
            // 否则松开鼠标会把已有的选中状态清掉。
            if (hasDraggedRef.current) suppressClickRef.current = true;
            rotationDragRef.current = null;
            if (isObjectDraggingRef.current && draggedObjectNameRef.current && interpreterRef.current) {
                const draggedName = draggedObjectNameRef.current;
                const constrained = draggedPropertyRef.current;
                // 带上渲染时记录的源码行号，保证同步回 DSL 时改的是同一行。
                const syncOptions = { lineNumber: interpreterRef.current.getSourceLineForObject(draggedName) };
                if (constrained) {
                    // 线上点 / 圆上点：写回的是 `distance=` / `angle=`，不是坐标。
                    const changes: Partial<Record<ObjectPropertyKey, number>> = {};
                    changes[constrained.key] = constrained.value;
                    onObjectPropertyChange(draggedName, changes, syncOptions);
                } else {
                    const element = interpreterRef.current.getEditableElementPosition(draggedName);
                    if (element) {
                        onObjectPropertyChange(draggedName, { x: element.x, y: element.y }, syncOptions);
                    }
                }
                interpreterRef.current.clearPreviewObjectProperties(draggedName);
                draggedPropertyRef.current = null;
            }
            isDraggingRef.current = false;
            activeSelectionRef.current = null;
            // 注意：不要在这里清 selectCommittedByMousedownRef —— mouseup 在 click 之前触发，
            // 在这里清掉的话 click 就看不到「mousedown 已经选过同一个对象」了，多选 toggle
            // 还是会打两次。清的工作交给下一次 mousedown 的开头。
            isLabelDraggingRef.current = false;
            isObjectDraggingRef.current = false;
            draggedObjectNameRef.current = null;
            canvas.style.cursor = 'grab';
        };

        const getCanvasPoint = (e: MouseEvent) => {
            const rect = canvas.getBoundingClientRect();
            // Canvas 的 CSS 尺寸可能与 width/height 属性不同，命中检测统一换算到画布像素。
            const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
            const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
            return {
                x: (e.clientX - rect.left) * scaleX,
                y: (e.clientY - rect.top) * scaleY,
            };
        };

        /**
         * 把画布坐标解析成「光标压在哪一段上」。
         *
         * 先要求光标离这条线足够近（借用同一个 12px 容差，换算成逻辑单位），
         * 否则鼠标在画布任何位置都会高亮某一段，看着像失灵。
         *
         * 除了段号，这里还把鼠标投影到线上的参数 `t` 一起返回 ——
         * 高亮按 `t` 落在哪段来定，真正删哪一段也由 `planLinearPieceRemoval`
         * 按同一个 `t` 重算，两者必须是同一份投影结果，
         * 否则会出现「高亮这段、删的是另一段」。
         */
        const resolveTrimHover = (canvasX: number, canvasY: number): TrimHover | null => {
            const session = trimSessionRef.current;
            const interpreter = interpreterRef.current;
            if (!session || !interpreter) return null;

            const logical = interpreter.screenToLogicalPoint(canvasX, canvasY, transformRef.current);
            const nearby = interpreter.screenToLogicalPoint(canvasX + HIT_TOLERANCE, canvasY, transformRef.current);
            if (!logical || !nearby) return null;
            const tolerance = Math.abs(nearby.x - logical.x);
            if (!(tolerance > 0)) return null;

            const { p1, p2 } = session;
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const length = Math.hypot(dx, dy);
            if (!(length > 0)) return null;
            const distance = Math.abs((logical.x - p1.x) * dy - (logical.y - p1.y) * dx) / length;
            if (distance > tolerance) return null;

            // 这里按 'line' 投影，不做端点钳制：直线上的点在定义区间之外时参数会是负数或大于 1，
            // 一钳就全被吸到端点上，分不出「无穷远那一侧」了。
            const t = projectOntoLinear(logical, p1, p2, 'line');
            if (t === null) return null;

            for (let i = 0; i < session.pieces.length; i++) {
                const piece = session.pieces[i];
                const lo = piece.startT ?? -Infinity;
                const hi = piece.endT ?? Infinity;
                if (t >= lo && t <= hi) return { index: i, t };
            }
            return null;
        };

        /**
         * 把画布坐标解析成「鼠标落在四个角中的哪一个里」。
         *
         * 和截取不同，这里**不要求鼠标贴近某条线**：四条射线把整个平面切成四个角，
         * 鼠标在画布任何位置都必然落在其中一个里。离顶点太近时方向抖得厉害，
         * `resolveAngleSector` 会返回 null，此时保持上一次的高亮不动。
         */
        const resolveAngleHover = (canvasX: number, canvasY: number): number | null => {
            const session = angleSessionRef.current;
            const interpreter = interpreterRef.current;
            if (!session || !interpreter) return null;
            const logical = interpreter.screenToLogicalPoint(canvasX, canvasY, transformRef.current);
            if (!logical) return null;
            return resolveAngleSector(session, logical);
        };

        /**
         * 把画布坐标解析成「光标压在哪个点对象上」。
         *
         * 只有真正的点对象算命中：截止点最终要写成 `cutPoints=` 里的点名，
         * 线、圆这些即使被点到也引用不了，所以直接当作没命中。
         */
        const resolveCutPointHover = (canvasX: number, canvasY: number): string | null => {
            const interpreter = interpreterRef.current;
            if (!interpreter) return null;
            const selection = interpreter.hitTestSelection(canvasX, canvasY, HIT_TOLERANCE, transformRef.current);
            if (!selection || selection.kind !== 'object') return null;
            const type = interpreter.getObject(selection.name)?.type;
            return type && isPointType(type) ? selection.name : null;
        };

        // Esc 退出截取模式或挑截止点模式。挂在 window 上，鼠标不在画布上时也能退出。
        // 真的用掉这次 Esc 就 preventDefault 标记一下 —— 全屏模式下 App 那层也监听 Esc，
        // 它看到这个标记就知道该按键已经被画布消费，不会顺手把全屏一起退掉。
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            if (cutPointPickRef.current) {
                e.preventDefault();
                onCancelCutPointPick();
                return;
            }
            if (trimSessionRef.current || angleSessionRef.current || isRotatingRef.current) {
                e.preventDefault();
            }
            if (trimSessionRef.current) exitTrimModeRef.current();
            if (angleSessionRef.current) exitAngleModeRef.current();
            if (isRotatingRef.current) setIsRotating(false);
        };
        window.addEventListener('keydown', handleKeyDown);

        // 使用 click 处理开锁模式的选择，避免依赖 window mouseup 在某些浏览器中丢失。
        const handleCanvasClick = (e: MouseEvent) => {
            setContextMenu(null);
            // 旋转模式：左键只用来拖视图，不做选择。拖动结束后的 click 也一并吞掉，
            // 否则「转一下视图」会被当成「点空白处」把已有选中清掉。
            if (isRotatingRef.current) return;
            // 挑截止点模式：点到点对象就把它交给上层写进 cutPoints，点空处不作反应。
            if (cutPointPickRef.current) {
                const pickPoint = getCanvasPoint(e);
                const pointName = resolveCutPointHover(pickPoint.x, pickPoint.y);
                if (pointName) onCutPointPicked(pointName);
                return;
            }
            // 截取模式：左键点中哪一段就删掉哪一段，然后退出。
            if (trimSessionRef.current) {
                const point = getCanvasPoint(e);
                const hover = resolveTrimHover(point.x, point.y);
                if (hover) commitTrimPieceRef.current(hover.t);
                return;
            }
            // 「两线成角」模式：左键点下去就作出当时高亮的那个角，然后退出。
            if (angleSessionRef.current) {
                const point = getCanvasPoint(e);
                const hover = resolveAngleHover(point.x, point.y);
                if (hover !== null) commitAngleRef.current(hover);
                return;
            }
            if (isLockedRef.current || !interpreterRef.current) return;
            if (suppressClickRef.current) {
                suppressClickRef.current = false;
                return;
            }
            const point = getCanvasPoint(e);
            const selection = interpreterRef.current.hitTestSelection(
                point.x,
                point.y,
                HIT_TOLERANCE,
                transformRef.current,
            );
            if (!selection) {
                onSelectObject(null);
                onSelectLabel(null);
            } else if (selection.kind === 'label') {
                onSelectLabel(selection.id);
                onSelectObject(null);
            } else {
                // mousedown 已经为这次手势选过同一个对象了，就别再 toggle 一次。
                // 见 selectCommittedByMousedownRef 的说明 —— 不加这个判断 ctrl+click
                // 会因为 add 一次 + remove 一次而完全无效。
                if (selectCommittedByMousedownRef.current !== selection.name) {
                    onSelectObject(selection.name, e.ctrlKey || e.metaKey);
                }
                onSelectLabel(null);
            }
        };

        const handleContextMenu = (e: MouseEvent) => {
            e.preventDefault();
            // 旋转模式下的右键是「退出旋转」，不弹菜单（和截取模式同一套约定）。
            if (isRotatingRef.current) {
                setIsRotating(false);
                return;
            }
            // 挑截止点模式下的右键同样是「取消」，不弹菜单。
            if (cutPointPickRef.current) {
                onCancelCutPointPick();
                return;
            }
            // 截取模式下的右键是「取消」，不弹菜单。
            if (trimSessionRef.current) {
                exitTrimModeRef.current();
                return;
            }
            // 「两线成角」模式下的右键同样是「取消」，不弹菜单。
            if (angleSessionRef.current) {
                exitAngleModeRef.current();
                return;
            }
            if (isLockedRef.current || !interpreterRef.current) return;

            const point = getCanvasPoint(e);
            const hit = interpreterRef.current.hitTestSelection(point.x, point.y, HIT_TOLERANCE, transformRef.current);
            // 右键处的逻辑坐标。两处在用：「在线上取点」要把点放在线上离这里最近的位置；
            // 空选右键作图要拿它当新图形的落脚点。都先算好随菜单一起存下来 ——
            // 菜单弹出来之后鼠标就移开了，等用户点菜单项时再取就来不及。
            const anchorPoint = interpreterRef.current.screenToLogicalPoint(point.x, point.y, transformRef.current);
            // 新建图形的「默认尺寸」：往右探固定像素再换算回逻辑长度，用的是和 anchorPoint
            // 同一个变换，所以无论当前缩放多少，新建的图形看起来都一样大。
            const probePoint = interpreterRef.current.screenToLogicalPoint(
                point.x + CREATE_SHAPE_SIZE_PX,
                point.y,
                transformRef.current,
            );
            const creationSize = anchorPoint && probePoint ? Math.abs(probePoint.x - anchorPoint.x) : 1;
            let objectNames = [...selectedObjectNames];
            if (hit?.kind === 'object' && !objectNames.includes(hit.name)) {
                const additive = e.ctrlKey || e.metaKey;
                objectNames = additive ? [...objectNames, hit.name] : [hit.name];
                onSelectObject(hit.name, additive);
            }

            const bounds = canvas.parentElement?.getBoundingClientRect() || canvas.getBoundingClientRect();
            // 每次右键都清掉二级菜单的展开状态，否则上一次展开过的分类会在新菜单里自动弹开。
            setOpenSubmenuId(null);

            // 没选中任何对象：菜单换成「在此处创建基本图形」。
            // 空白处右键的语义是「从零开始画」，所以这里不出现删除之类的对象操作。
            if (objectNames.length === 0) {
                // 拿不到逻辑坐标就没法决定图形落在哪，宁可不弹菜单。
                if (!anchorPoint) return;
                setContextMenu({
                    x: e.clientX - bounds.left,
                    y: e.clientY - bounds.top,
                    title: '在此处创建',
                    objects: [],
                    items: CREATE_MENU_ITEMS,
                    anchorPoint,
                    creationSize,
                });
                return;
            }

            const payload = buildObjectMenu(objectNames, anchorPoint, creationSize);
            if (payload) setContextMenu({ x: e.clientX, y: e.clientY, ...payload });
        };

        const handleWheel = (e: WheelEvent) => {
            // 滚轮缩放。闭锁状态下始终生效，与开锁状态下的空白区域行为一致。
            e.preventDefault();

            const wheelPoint = getCanvasPoint(e);
            const mouseX = wheelPoint.x;
            const mouseY = wheelPoint.y;

            // 开锁状态下光标压在元素（点、文本或标签）上时不缩放，避免在元素附近误改视图比例。
            // 判定容差与 hover / 左键拖动共用 HIT_TOLERANCE，所以「点得到的东西」和
            // 「挡住滚轮的东西」永远是同一批。闭锁状态不参与元素交互，因此始终缩放。
            let hoveringElement = false;
            // 截取模式下光标必然压在线上，但滚轮仍应该是缩放视图，不能因为「命中元素」就被吃掉。
            // 「两线成角」同理：鼠标可能正好压在某个点上，但滚轮仍该缩放。
            if (
                !isLockedRef.current && interpreterRef.current
                && !trimSessionRef.current && !angleSessionRef.current
            ) {
                hoveringElement = interpreterRef.current.hitTestSelection(
                    mouseX,
                    mouseY,
                    HIT_TOLERANCE,
                    transformRef.current,
                ) !== null;
            }
            if (!resolveWheelZoom(isLockedRef.current, hoveringElement)) return;

            const scaleFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
            // 锚点缩放：光标下那个点保持不动。有旋转时不能直接把光标坐标代进老公式 ——
            // 老公式默认「屏幕 = 缩放 · 坐标 + 平移」，旋转之后得先把光标反旋转回去。
            transformRef.current = zoomViewAt(
                transformRef.current,
                canvas.width,
                canvas.height,
                mouseX,
                mouseY,
                transformRef.current.scale * scaleFactor,
            );
            redraw();
        };

        canvas.addEventListener('mousedown', handleMouseDown);
        canvas.addEventListener('click', handleCanvasClick);
        canvas.addEventListener('contextmenu', handleContextMenu);
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        canvas.addEventListener('wheel', handleWheel, { passive: false });

        return () => {
            canvas.removeEventListener('mousedown', handleMouseDown);
            canvas.removeEventListener('click', handleCanvasClick);
            canvas.removeEventListener('contextmenu', handleContextMenu);
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
            window.removeEventListener('keydown', handleKeyDown);
            canvas.removeEventListener('wheel', handleWheel);
        };
    }, [isLocked, onSelectObject, onSelectLabel, onLabelPositionChange, onObjectPropertyChange, onCutPointPicked, onCancelCutPointPick, redraw, buildContext]);

    // 重置视图 = 清掉交互式的平移/缩放/旋转。脚本里 `VIEW centerX/centerY/scale/rotation`
    // 声明的基准量不在这个 ref 里，所以重置后它们依然生效（和以前只重置平移缩放一致）。
    const handleResetView = () => {
        transformRef.current = createView();
        setIsRotating(false);
        redraw();
    };

    /**
     * 暂停 / 继续动画。
     *
     * 两条动画调度一起停、一起走：`ANIMATE` 的延时作图由 setTimeout 驱动，
     * `CREATE ANIMATION` 的逐帧播放由 rAF 驱动，暂停必须两边都按住，
     * 否则「按了暂停但图还在一个个冒出来」。解释器里那一个 `animationPaused` 开关同时管住两者。
     */
    const handleTogglePause = useCallback(() => {
        const interpreter = interpreterRef.current;
        if (!interpreter) return;
        if (isPausedRef.current) {
            isPausedRef.current = false;
            setIsPaused(false);
            interpreter.resumeAnimations();
        } else {
            isPausedRef.current = true;
            setIsPaused(true);
            interpreter.pauseAnimations();
        }
    }, []);

    // 轮询「有没有动画在跑」和「单步到第几项了」，只用来驱动按钮的可用态和提示文案。
    // 400ms 足够跟上「动画播完了」这件事，又不会因为太频繁而影响绘制。
    useEffect(() => {
        const timer = window.setInterval(() => {
            const interpreter = interpreterRef.current;
            setHasActiveAnimation(interpreter ? interpreter.hasActiveAnimations() : false);
            const progress = interpreter?.getDelayedDrawProgress();
            setStepProgressLabel(progress ? `${progress.drawn} / ${progress.total}` : '');
        }, 400);
        return () => window.clearInterval(timer);
    }, []);

    /**
     * 单步绘制：每点一次，画布上只多出**一个绘制指令**的结果。
     *
     * 有没有 `ANIMATE` 都能用 —— 暂停这个动作本身就会让解释器把绘制排成队列
     * （见 `DSLInterpreter.execute` 里那段），静态脚本因此也变成「一项一项画」。
     *
     * 三步：
     *   1. 先把自动播放按住 —— 单步的手动推进和定时器/RAF 是互斥的，不按住的话
     *      间隔一到它就自己往下跑，用户看到的是「点一下然后自己跑完」。
     *      对静态脚本来说，这一步同时也是「切换成逐项模式」的开关。
     *   2. 这一轮还有没画完的项，直接推进一步。
     *   3. 没有可推进的东西了（队列放完 / 动画播完 / 还没执行过），就重新装填一轮再推一步：
     *      走「执行代码」那条路（跑编辑器里的脚本，结果不会和点执行分叉），
     *      用 `hold` 姿态停在第一项之前，真正的那一步由 redraw 里的 `pendingStepRef` 兑现。
     */
    const handleStepDraw = useCallback(() => {
        const interpreter = interpreterRef.current;
        if (!interpreter) return;

        if (!isPausedRef.current) {
            isPausedRef.current = true;
            setIsPaused(true);
            interpreter.pauseAnimations();
        }

        if (interpreter.canStep()) {
            interpreter.step();
            return;
        }

        // 重新装填。为什么不在这一行直接 step()：onExecute 是 state 更新 → effect → redraw
        // 的**异步**路径，此刻队列还没装填好，step() 只会返回 false 什么都不画。
        pendingStepRef.current = true;
        restartIntentRef.current = 'hold';
        onExecute();
    }, [onExecute]);

    // 生成 SVG 源码，并复用当前画布的缩放/平移视图。
    // 这样用户在画布中放大到 500% 后导出的 SVG 也会保留该视图状态。
    const buildSvg = () => exportScriptToSvg(script, {
        width,
        height,
        view: {
            scale: transformRef.current.scale,
            offsetX: transformRef.current.x,
            offsetY: transformRef.current.y,
            rotation: transformRef.current.rotation,
        },
    });

    const handleExportSvg = () => {
        try {
            const svg = buildSvg();
            downloadSvg(svg, /CREATE\s+ANIMATION/i.test(script) ? 'geometry-animation.svg' : 'geometry.svg');
        } catch (error) {
            console.error('Failed to export SVG:', error);
        }
    };

    const handleCopySvg = async () => {
        try {
            const svg = buildSvg();
            await copySvgToClipboard(svg);
        } catch (error) {
            console.error('Failed to copy SVG:', error);
        }
    };

    // 对话框里实时预览的代码。预览和最终插入走的是同一次计算，
    // 不会出现「预览显示 A、确定后插入 B」这种对不上的情况。
    const dialogCommands = useMemo(() => {
        if (!pickDialog) return [];
        return buildPickOperationCommands(pickDialog, buildContext());
    }, [pickDialog, buildContext]);

    const handleSelectionOperation = useCallback((operation: SelectionOperation, objects: ObjectRef[]) => {
        const commands = buildSelectionOperationCommands(operation, objects, buildContext());
        if (commands.length > 0) onGeometryCommands(commands);
    }, [buildContext, onGeometryCommands]);

    // 选中一个圆时的作图：圆周最近点 / 圆心 / 切线 / 法线。即时生成、不需要对话框。
    const handleCircleOperation = useCallback((operation: CircleOperation, anchor: ObjectRef, anchorPoint: Point2D | null) => {
        const plan = planCircleOperation(operation, anchor, anchorPoint, buildContext());
        if (plan.commands.length > 0) onGeometryCommands(plan.commands);
    }, [buildContext, onGeometryCommands]);

    // 空选右键的「在此处创建」。落脚点、默认尺寸都来自右键那一刻存下来的值，
    // 生成指令后走和别的作图完全相同的通道（追加到脚本末尾并重跑），不另开写回路径。
    const handleCreateShape = useCallback((kind: CreateShapeKind, anchor: Point2D | null, size?: number) => {
        if (!anchor) return;
        // 文字不直接作图：内容、字号、颜色都得先问用户。这里只负责把对话框打开，
        // 真正生成指令要等用户在对话框里按了「插入」（见 handleSubmitText）。
        if (kind === 'text') {
            setTextDialog({
                anchor,
                value: {
                    content: '',
                    fontSize: 16,
                    color: '#1f2937',
                    fontFamily: 'Arial',
                    italic: false,
                    bold: false,
                    backgroundColor: '',
                    padding: 4,
                },
            });
            return;
        }
        const commands = buildCreateShapeCommands({ kind, anchor, size: size ?? 1 }, buildContext());
        if (commands.length > 0) onGeometryCommands(commands);
    }, [buildContext, onGeometryCommands]);

    // 文字对话框里「将插入的指令」预览与最终插入走的是**同一次计算**，
    // 不会出现「预览显示 A、确定后插入 B」这种对不上的情况。
    //
    // 编辑模式下预览的是「这一行将变成什么」：拿原行文本套同一个改写函数，
    // 和提交时落地的完全一致。不能用 `buildCreateShapeCommands` —— 那会按
    // 当前画布变换重新算坐标，得到一条 x/y 都变了的「新指令」，预览就骗人了。
    const textDialogCommand = useMemo(() => {
        if (!textDialog) return '';
        if (textDialog.editLine !== undefined && textDialog.sourceLine !== undefined) {
            return rewriteTextCommandLine(textDialog.sourceLine, textDialog.value) ?? '';
        }
        const commands = buildCreateShapeCommands({
            kind: 'text',
            anchor: textDialog.anchor,
            size: 1,
            text: textDialog.value,
        }, buildContext());
        return commands[0] ?? '';
    }, [textDialog, buildContext]);

    const handleSubmitText = useCallback((value: CreateTextSpec) => {
        if (!textDialog) return;
        // 编辑：原地改写那一行，不追加新指令、也不动它的坐标。
        if (textDialog.editLine !== undefined) {
            const line = textDialog.editLine;
            setTextDialog(null);
            onTextLineChange(line, value);
            return;
        }
        const commands = buildCreateShapeCommands({
            kind: 'text',
            anchor: textDialog.anchor,
            size: 1,
            text: value,
        }, buildContext());
        setTextDialog(null);
        if (commands.length > 0) onGeometryCommands(commands);
    }, [textDialog, buildContext, onGeometryCommands, onTextLineChange]);

    // 打开「编辑文字」对话框：内容与样式从**脚本原行**解析回来，而不是从解释器里
    // 那份已经求值过的 text（槽位 `{len}` 会被替换成数字，再存回去就把表达式弄丢了）。
    const handleOpenTextDialog = useCallback((name: string) => {
        const interpreter = interpreterRef.current;
        if (!interpreter) return;
        const info = interpreter.getEditableText(name);
        if (!info) return;
        // 先看当前生效脚本（可能是用户正在编辑的那份），再看生成脚本。
        const lineText = script.split('\n')[info.lineNumber - 1];
        const spec = lineText ? parseTextCommandLine(lineText) : null;
        if (!spec) return;
        const position = interpreter.getEditableElementPosition(name);
        setTextDialog({
            anchor: position ? { x: position.x, y: position.y } : { x: 0, y: 0 },
            value: spec,
            editLine: info.lineNumber,
            sourceLine: lineText,
        });
    }, [script]);

    // 对话框里的命中测试直接借用解释器：副本与主画布的像素尺寸、视图变换完全一致，
    // 所以同一个画布像素坐标在两边指向同一个对象，不必再维护第二套几何。
    const handleDialogHitTest = useCallback((canvasX: number, canvasY: number) => {
        const interpreter = interpreterRef.current;
        if (!interpreter) return null;
        const selection = interpreter.hitTestSelection(canvasX, canvasY, HIT_TOLERANCE, transformRef.current);
        if (!selection) return null;
        // 点到标签也算点到它所属的对象，否则用户会觉得「明明点在线上却没反应」。
        const name = selection.kind === 'label' ? selection.objectName : selection.name;
        const type = interpreter.getObject(name)?.type;
        return type ? { name, type } : null;
    }, []);

    const handleDialogHighlight = useCallback((ctx: CanvasRenderingContext2D, name: string, color: string) => {
        interpreterRef.current?.drawObjectHighlight(ctx, name, transformRef.current, { color });
    }, []);

    const handleDialogConfirm = useCallback(() => {
        if (dialogCommands.length === 0) return;
        onGeometryCommands(dialogCommands);
        setPickDialog(null);
    }, [dialogCommands, onGeometryCommands]);

    const handleOpenPickOperation = useCallback((operation: PickOperation, object: ObjectRef, anchorPoint: Point2D | null) => {
        // 描述符要用到画布现状：线性主体的两个定义点名（顶点下拉框）、
        // 以及脚本里已有的角（「取已创建的角」下拉框）。开对话框时取一次快照。
        const interpreter = interpreterRef.current;
        const descriptorContext: PickDescriptorContext = {
            linearEndpoints: interpreter?.getLinearEndpointNames(object.name) ?? null,
            angleNames: interpreter
                ? Array.from(interpreter.getAllObjects().entries())
                    .filter(([, value]) => value.type === ANGLE_OBJECT_TYPE)
                    .map(([name]) => name)
                : [],
            // 「延长」要能「延长到某条已有线段的长度」，候选就是当前所有线性对象。
            // 和 angleNames 一样在**开对话框那一刻**取快照：对话框开着的时候脚本不会变，
            // 中途重取反而可能拿到另一份脚本里的名字。
            linearNames: interpreter
                ? Array.from(interpreter.getAllObjects().entries())
                    .filter(([, value]) => isLinearType(value.type))
                    .map(([name]) => name)
                : [],
        };
        setPickDialog({
            kind: operation,
            anchorName: object.name,
            anchorType: object.type,
            targetName: null,
            // 「在线上取点」需要它；其余操作用不到，留着也无害。
            anchorPoint,
            // 默认值来自描述符，避免「隐藏字段没有初始值 -> 生成代码时读到 undefined」。
            options: describePickOperation(operation, object.name, object.type, descriptorContext).defaults,
            // 样式一开始全空 = 全用默认值。空的项**不会**出现在生成的指令里。
            style: {},
            descriptorContext,
        });
    }, []);

    // 打开「修改标签」对话框。值、行号、能不能改全部来自解释器：
    // 标签挂在哪一行（定义行还是 DRAW 行）只有解释器知道，画布不该自己猜。
    const handleOpenLabelDialog = useCallback((object: ObjectRef) => {
        const property = interpreterRef.current?.getEditableLabel(object.name);
        if (!property) return;
        setLabelDialog({
            name: object.name,
            type: object.type,
            value: property.value,
            lineNumber: property.lineNumber,
            editable: property.editable,
            reason: property.reason,
        });
    }, []);

    // 删除：把「要删谁」和「解释器此刻的指令表」一起交给上层去改写脚本。
    // 指令表在这里取快照，不放到上层再取 —— 上层没有解释器，而且晚了脚本可能已经变了。
    const handleDeleteObjects = useCallback((names: string[]) => {
        const interpreter = interpreterRef.current;
        if (!interpreter || names.length === 0) return;
        onDeleteObjects(names, interpreter.getTopLevelCommands());
    }, [onDeleteObjects]);

    // 进入截取模式。分段在这里算一次就存下来 —— 之后鼠标每次移动都拿它判断压在哪一段上，
    // 不必反复去问解释器有哪些点。菜单里也算过一次同样的东西，两次都是纯函数，
    // 输入没变结果就一致，不会出现「菜单说能点、点下去进不去」。
    const handleStartTrim = useCallback((object: ObjectRef) => {
        const coords = interpreterRef.current?.getLinearEndpointCoords(object.name);
        if (!coords) return;
        const pieceSet = listLinearPieces(
            { anchorName: object.name, anchorType: object.type },
            buildContext(),
        );
        if (pieceSet.blocked) return;

        const session: TrimSession = {
            anchorName: object.name,
            anchorType: object.type,
            pieces: pieceSet.pieces,
            p1: coords.p1,
            p2: coords.p2,
        };
        trimSessionRef.current = session;
        trimHoverRef.current = null;
        setTrimSession(session);
        setTrimHover(null);
        setContextMenu(null);
        redrawRef.current();
    }, [buildContext]);

    const exitTrimMode = useCallback(() => {
        if (!trimSessionRef.current) return;
        trimSessionRef.current = null;
        trimHoverRef.current = null;
        setTrimSession(null);
        setTrimHover(null);
        redrawRef.current();
    }, []);

    // 删掉鼠标所在的那一段。真正删哪一段由 planner 按「鼠标在线上投影的参数位置」重算，
    // 这里只把那个参数 `t` 交下去。
    //
    // planner 只返回一串新的 `cutPoints=`，**不产生任何指令、也不创建任何点**：
    // 鼠标落在无界尾部（`−∞ → A` / `B → +∞`）时直接省掉无界那一侧的 token，
    // 于是整条尾巴一次删干净。
    const commitTrimPiece = useCallback((tMouse: number) => {
        const session = trimSessionRef.current;
        const interpreter = interpreterRef.current;
        if (!session || !interpreter) return;
        const outcome = planLinearPieceRemoval({
            anchorName: session.anchorName,
            anchorType: session.anchorType,
            tMouse,
        }, buildContext());
        exitTrimMode();
        if (!outcome.plan) return;
        onLinearTrim({
            name: session.anchorName,
            cutPoints: outcome.plan.cutPoints,
        }, interpreter.getTopLevelCommands());
    }, [buildContext, exitTrimMode, onLinearTrim]);

    // 画布事件处理函数挂在 effect 里，改一次依赖就要重绑一遍监听器，
    // 所以用 ref 把最新的回调递进去（和 redrawRef 同一套做法）。
    useEffect(() => {
        exitTrimModeRef.current = exitTrimMode;
        commitTrimPieceRef.current = commitTrimPiece;
    }, [exitTrimMode, commitTrimPiece]);

    // 脚本一变（重跑、改属性、删对象…），已经算好的分段就作废了，直接退出截取模式，
    // 免得鼠标还在按旧的分段高亮，点下去却删到了别的东西。
    useEffect(() => {
        exitTrimModeRef.current();
        // 同理，「两线成角」记的是顶点坐标与四条射线的方位角，图形一动就全过期了。
        exitAngleModeRef.current();
    }, [script, revision]);

    // ---------------------------------------------------------------- 两线成角

    // 进入「两线成角」模式。四条射线与顶点在这里算一次就存下来，
    // 之后鼠标每次移动只拿它判断落在哪个角里，不必反复去问解释器。
    const handleStartAnglePick = useCallback((objects: ObjectRef[]) => {
        if (objects.length !== 2) return;
        const plan = describeTwoLineAngles(objects[0], objects[1], buildContext());
        if ('blocked' in plan) return;
        angleSessionRef.current = plan;
        angleHoverRef.current = null;
        setAngleSession(plan);
        setAngleHover(null);
        setContextMenu(null);
        redrawRef.current();
    }, [buildContext]);

    const exitAngleMode = useCallback(() => {
        if (!angleSessionRef.current) return;
        angleSessionRef.current = null;
        angleHoverRef.current = null;
        setAngleSession(null);
        setAngleHover(null);
        redrawRef.current();
    }, []);

    // 作出鼠标所在的那个角。角的顶点与两条边全部来自已存在的点，
    // 「反向延长」那一侧没有现成的点时才补一个（见 buildTwoLineAngleCommands）。
    const commitAngle = useCallback((sectorIndex: number) => {
        const session = angleSessionRef.current;
        if (!session) return;
        const commands = buildTwoLineAngleCommands(session, sectorIndex, buildContext());
        exitAngleMode();
        if (commands.length === 0) return;
        onGeometryCommands(commands);
    }, [buildContext, exitAngleMode, onGeometryCommands]);

    // 同样用 ref 把最新的回调递给挂在 effect 里的事件处理函数。
    // 单独一个 effect 而不是并入上面那个：这两个回调定义在它之后，合进去会撞上
    // 「块级变量在声明前使用」。
    useEffect(() => {
        exitAngleModeRef.current = exitAngleMode;
        commitAngleRef.current = commitAngle;
    }, [exitAngleMode, commitAngle]);

    // 把「正在挑截止点」的请求同步进 ref：画布事件处理函数挂在 effect 里，
    // 只有 ref 能让它们读到最新值而不必重绑监听器。
    useEffect(() => {
        cutPointPickRef.current = cutPointPick;
        if (canvasRef.current) canvasRef.current.style.cursor = cutPointPick ? 'crosshair' : 'grab';
    }, [cutPointPick]);

    // 把「旋转模式」同步进 ref（画布事件处理函数挂在 effect 里，只有 ref 能让它们读到最新值），
    // 并退出可能残留的旋转拖动会话。光标统一用抓取手势：旋转模式下不管压在哪儿
    // 都是拖视图，不必再区分「可点元素」。
    useEffect(() => {
        isRotatingRef.current = isRotating;
        rotationDragRef.current = null;
        if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
    }, [isRotating]);

    const handleDialogOptionChange = useCallback((key: string, value: string | number | boolean) => {
        setPickDialog(previous => (
            previous ? { ...previous, options: { ...previous.options, [key]: value } } : previous
        ));
    }, []);

    // 样式改动。清空某一项就把它从 style 里删掉 —— 「没有值」=「用默认」，
    // 留着空串/undefined 会让生成的指令里多出一个空参数。
    const handleDialogStyleChange = useCallback((key: keyof PickStyleOptions, value: string | number) => {
        setPickDialog(previous => {
            if (!previous) return previous;
            const nextStyle = { ...previous.style };
            if (value === '' || value === undefined) delete nextStyle[key];
            else (nextStyle as Record<string, string | number>)[key] = value;
            return { ...previous, style: nextStyle };
        });
    }, []);

    // 作图对话框里的**实时预览**：把将要插入的那几条指令画到对话框的预览层上。
    // 只画新增的指令，底下的既有图形是主画布的像素副本 ——
    // 所以随机点不会跳位置、动画不会重启、KaTeX 也不会重排。
    const handleDialogPreview = useCallback((ctx: CanvasRenderingContext2D, previewCommands: string[]) => {
        interpreterRef.current?.renderPreviewCommands(ctx, previewCommands, transformRef.current);
    }, []);

    /** 对话框里的画布像素坐标 → 逻辑坐标（「在线上取点」拖动时用）。 */
    const handleDialogToLogicalPoint = useCallback((canvasX: number, canvasY: number) => (
        interpreterRef.current?.screenToLogicalPoint(canvasX, canvasY, transformRef.current) ?? null
    ), []);

    /**
     * 在对话框里拖动调整落点。
     *
     * 改的是 `pickDialog.anchorPoint` —— 生成代码和预览都是从它派生出来的，
     * 所以这一处改动会让「将插入的代码」和左边图形上的那个点同时跟着走。
     */
    const handleDialogAnchorPointChange = useCallback((point: Point2D) => {
        setPickDialog(previous => (previous ? { ...previous, anchorPoint: point } : previous));
    }, []);

    // 右键菜单项的渲染。分类项（有 children）渲染成悬停展开的父项，叶子渲染成可点项。
    // 用递归而不是写死两层：目录以后再加一层子分类，这里不用改。
    const renderContextMenuItem = (menu: ContextMenuState, item: ContextMenuItem): React.ReactNode => {
        if (item.children && item.children.length > 0) {
            const open = openSubmenuId === item.id;
            // 菜单落在窗口右半边时二级菜单往左弹，否则会被视口右边缘切掉。
            // 用窗口宽度而不是画布宽度：菜单按视口定位，参照物必须一致。
            const flip = menu.x > window.innerWidth * 0.55;
            return (
                <ContextMenuGroup
                    key={item.id}
                    onMouseEnter={() => setOpenSubmenuId(item.id)}
                    // 二级菜单是父项的 DOM 子节点，鼠标移进去不会触发 leave，
                    // 所以「从父项滑到子项」这一路不会把菜单关掉。
                    onMouseLeave={() => setOpenSubmenuId(current => (current === item.id ? null : current))}
                >
                    <ContextMenuGroupButton
                        type="button"
                        title={item.title}
                        $open={open}
                        onClick={() => setOpenSubmenuId(open ? null : item.id)}
                    >
                        <span>{item.label}</span>
                        <ContextMenuArrow>{flip ? '◂' : '▸'}</ContextMenuArrow>
                    </ContextMenuGroupButton>
                    {open && (
                        <ContextSubMenu $flip={flip}>
                            {item.children.map(child => renderContextMenuItem(menu, child))}
                        </ContextSubMenu>
                    )}
                </ContextMenuGroup>
            );
        }

        return (
            <ContextMenuItemButton
                key={item.id}
                type="button"
                disabled={item.disabled}
                title={item.title}
                onClick={() => {
                    if (item.selectionOperation) {
                        handleSelectionOperation(item.selectionOperation, menu.objects);
                    } else if (item.pickOperation) {
                        handleOpenPickOperation(item.pickOperation, menu.objects[0], menu.anchorPoint ?? null);
                    } else if (item.circleOperation) {
                        handleCircleOperation(item.circleOperation, menu.objects[0], menu.anchorPoint ?? null);
                    } else if (item.deleteObjects) {
                        handleDeleteObjects(item.deleteObjects);
                    } else if (item.editText) {
                        handleOpenTextDialog(menu.objects[0].name);
                    } else if (item.deleteTextLine !== undefined) {
                        onDeleteText(item.deleteTextLine);
                    } else if (item.trimMode) {
                        handleStartTrim(menu.objects[0]);
                    } else if (item.anglePick) {
                        handleStartAnglePick(menu.objects);
                    } else if (item.editLabel) {
                        handleOpenLabelDialog(menu.objects[0]);
                    } else if (item.editObject) {
                        onRequestObjectEdit(menu.objects[0].name);
                    } else if (item.createShape) {
                        handleCreateShape(item.createShape, menu.anchorPoint ?? null, menu.creationSize);
                    }
                    setContextMenu(null);
                }}
            >
                {item.label}
            </ContextMenuItemButton>
        );
    };

    return (
        <CanvasContainer>
            <ControlsOverlay $collapsed={isToolbarCollapsed}>
                {isToolbarCollapsed ? (
                    // 收起状态：整条工具栏缩成一个按钮，点它再展开。
                    <IconButton
                        onClick={() => setIsToolbarCollapsed(false)}
                        title="展开画布工具栏"
                        aria-label="展开画布工具栏"
                        aria-expanded={false}
                    >
                        <FiMoreHorizontal />
                    </IconButton>
                ) : (
                    <>
                        {/* 第一行：运行控制 + 视图操作模式。按使用频率从上到下、从右到左排。 */}
                        <ControlRow>
                            <IconButton
                                onClick={onExecute}
                                title="执行代码：按当前脚本重新绘制，并从头播放动画"
                                aria-label="执行代码"
                            >
                                <FiPlayCircle />
                            </IconButton>
                            <IconButton
                                onClick={handleTogglePause}
                                // 没有任何动画在跑、也不是暂停态时置灰：点下去不会有任何效果。
                                // 暂停态下必须保持可点，否则就没法继续了。
                                disabled={!hasActiveAnimation && !isPaused}
                                title={isPaused
                                    ? '继续播放动画：从暂停的地方接着画'
                                    : '暂停播放动画：作图动画和逐帧播放一起停，已画出的内容保留'}
                                aria-label={isPaused ? '继续播放动画' : '暂停播放动画'}
                                aria-pressed={isPaused}
                                $active={isPaused}
                            >
                                {isPaused ? <FiPlay /> : <FiPause />}
                            </IconButton>
                            <IconButton
                                onClick={handleStepDraw}
                                title={`单步绘制：每点一次只往前画一个绘制指令${stepProgressLabel ? `（当前 ${stepProgressLabel}）` : ''}。会先自动暂停；这一轮已经放完就从头重新开始单步`}
                                aria-label="单步绘制"
                            >
                                <FiSkipForward />
                            </IconButton>
                            <IconButton onClick={() => setIsLocked(previous => !previous)} title={isLocked ? '闭锁：拖动和缩放绘图区；点击解锁后编辑元素' : '开锁：选择和编辑元素；在空白处拖动或滚动滚轮可移动和缩放视图'} aria-label={isLocked ? '解锁编辑模式' : '锁定视图模式'} aria-pressed={isLocked} $active={isLocked}>
                                {isLocked ? <FiLock /> : <FiUnlock />}
                            </IconButton>
                            <IconButton
                                onClick={() => setIsRotating(previous => !previous)}
                                title={isRotating
                                    ? `旋转视图：左键拖动绕画布中心旋转；按住 Shift 吸附到 15°。点击取消旋转模式${transformRef.current.rotation ? `（当前 ${Math.round(radiansToDegrees(transformRef.current.rotation))}°）` : ''}`
                                    : '旋转视图：点击进入旋转模式，然后用鼠标拖动绕画布中心旋转'}
                                aria-label={isRotating ? '退出旋转视图模式' : '进入旋转视图模式'}
                                aria-pressed={isRotating}
                                $active={isRotating}
                            >
                                <FiRotateCw />
                            </IconButton>
                        </ControlRow>
                        {/* 第二行：视图复位 + 全屏与输出，外加把工具栏收起来的开关。 */}
                        <ControlRow>
                            <IconButton onClick={handleResetView} title="重置视图" aria-label="重置视图">
                                <FiMaximize />
                            </IconButton>
                            <IconButton
                                onClick={onToggleFullscreen}
                                title={isFullscreen
                                    ? '退出全屏作图（Esc）：恢复两侧面板'
                                    : '全屏作图：隐藏两侧面板，让画布铺满窗口（浏览器按 F11 则铺满整个屏幕）'}
                                aria-label={isFullscreen ? '退出全屏作图' : '进入全屏作图'}
                                aria-pressed={isFullscreen}
                                $active={isFullscreen}
                            >
                                {isFullscreen ? <FiMinimize2 /> : <FiMaximize2 />}
                            </IconButton>
                            <IconButton onClick={handleExportSvg} title="导出 SVG 文件" aria-label="导出 SVG 文件">
                                <FiDownload />
                            </IconButton>
                            <IconButton onClick={handleCopySvg} title="复制 SVG 代码" aria-label="复制 SVG 代码">
                                <FiCopy />
                            </IconButton>
                            <IconButton
                                onClick={() => setIsToolbarCollapsed(true)}
                                title="收起工具栏：只留一个按钮，需要时再展开"
                                aria-label="收起工具栏"
                                aria-expanded
                            >
                                <FiChevronRight />
                            </IconButton>
                        </ControlRow>
                    </>
                )}
            </ControlsOverlay>
            <canvas ref={canvasRef} width={width} height={height} />
            {isRotating && (
                <TrimHint>
                    <TrimHintTitle>旋转视图</TrimHintTitle>
                    <span>左键拖动绕画布中心旋转，按住 Shift 吸附到 15°</span>
                    <TrimHintMuted>Esc 或右键退出</TrimHintMuted>
                </TrimHint>
            )}
            {trimSession && (
                <TrimHint>
                    <TrimHintTitle>截取线段：{trimSession.anchorName}</TrimHintTitle>
                    <span>
                        {trimHover === null
                            ? '把鼠标移到这条线上，高亮的那一段会被删除'
                            : `单击删除这一段：${trimSession.pieces[trimHover]?.label ?? ''}`}
                    </span>
                    <TrimHintMuted>
                        {trimSession.pieces.some(piece => piece.startName === null || piece.endName === null)
                            ? '带 ∞ 的段是无限延伸部分，点一下整条删除；Esc 或右键退出'
                            : 'Esc 或右键退出'}
                    </TrimHintMuted>
                </TrimHint>
            )}
            {cutPointPick && (
                <TrimHint>
                    <TrimHintTitle>
                        挑截止点：{cutPointPick.objectName}（{cutPointPick.sign === '+' ? '砍正方向一侧' : '砍负方向一侧'}）
                    </TrimHintTitle>
                    <span>在画布上点一个点，它会被写进这一行的 cutPoints</span>
                    <TrimHintMuted>Esc 或右键退出</TrimHintMuted>
                </TrimHint>
            )}
            {angleSession && (
                <TrimHint>
                    <TrimHintTitle>作角：顶点 {angleSession.vertex}</TrimHintTitle>
                    <span>
                        {angleHover === null
                            ? '把鼠标移到要作的那个角里，夹出它的两条射线会变色'
                            : `单击作出这个角：${Math.round(angleSession.sectors[angleHover]?.span ?? 0)}°`}
                    </span>
                    <TrimHintMuted>Esc 或右键退出</TrimHintMuted>
                </TrimHint>
            )}
            {contextMenu && (
                <ContextMenu
                    ref={contextMenuRef}
                    style={{ left: contextMenu.x, top: contextMenuTop(contextMenu, window.innerHeight) }}
                    onMouseDown={event => event.stopPropagation()}
                >
                    <ContextMenuTitle>{contextMenu.title}</ContextMenuTitle>
                    {contextMenu.items.map(item => renderContextMenuItem(contextMenu, item))}
                </ContextMenu>
            )}
            {pickDialog && (
                <GeometryPickDialog
                    anchorName={pickDialog.anchorName}
                    anchorType={pickDialog.anchorType}
                    kind={pickDialog.kind}
                    targetName={pickDialog.targetName}
                    options={pickDialog.options}
                    style={pickDialog.style ?? {}}
                    descriptorContext={pickDialog.descriptorContext}
                    sourceCanvas={canvasRef.current}
                    canvasWidth={width}
                    canvasHeight={height}
                    commands={dialogCommands}
                    onPick={name => setPickDialog(previous => (previous ? { ...previous, targetName: name } : previous))}
                    onOptionChange={handleDialogOptionChange}
                    onStyleChange={handleDialogStyleChange}
                    hitTest={handleDialogHitTest}
                    toLogicalPoint={handleDialogToLogicalPoint}
                    onAnchorPointChange={handleDialogAnchorPointChange}
                    drawHighlight={handleDialogHighlight}
                    renderPreview={handleDialogPreview}
                    onCancel={() => setPickDialog(null)}
                    onConfirm={handleDialogConfirm}
                />
            )}
            {labelDialog && (
                <LabelEditDialog
                    objectName={labelDialog.name}
                    objectType={labelDialog.type}
                    initialValue={labelDialog.value}
                    lineNumber={labelDialog.lineNumber}
                    // 传的就是解释器刚跑过的那份脚本（上层把 generatedScript 作为 script 传进来），
                    // 所以行号和内容一定对得上，预览不会指到别的行。
                    script={script}
                    editable={labelDialog.editable}
                    reason={labelDialog.reason}
                    onCancel={() => setLabelDialog(null)}
                    onSubmit={value => {
                        const target = labelDialog;
                        setLabelDialog(null);
                        onLabelChange(target.name, value, target.lineNumber);
                    }}
                />
            )}
            {textDialog && (
                <TextCreateDialog
                    anchor={textDialog.anchor}
                    command={textDialogCommand}
                    initialValue={textDialog.value}
                    mode={textDialog.editLine !== undefined ? 'edit' : 'create'}
                    onCancel={() => setTextDialog(null)}
                    onSubmit={handleSubmitText}
                />
            )}
        </CanvasContainer>
    );
};

const CanvasContainer = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  canvas {
    display: block;
  }
`;

// 截取模式下的提示条。放在左上角（右下角被视图控制按钮占着），
// pointer-events: none 让它不挡住画布的鼠标事件。
const TrimHint = styled.div`
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-width: 60%;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid #e11d48;
  border-left-width: 3px;
  border-radius: 6px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  color: #1f2937;
  font-size: 0.78rem;
  line-height: 1.5;
  pointer-events: none;
`;

const TrimHintTitle = styled.strong`
  color: #e11d48;
  font-size: 0.8rem;
`;

const TrimHintMuted = styled.span`
  color: #64748b;
  font-size: 0.72rem;
`;

const ContextMenu = styled.div`
  /* 按**视口**定位（不是画布容器）：菜单有两个来源 —— 画布右键和变量表右键，
     后者在面板里，用容器坐标算不出来。统一成页面坐标之后两边共用一套定位逻辑。 */
  position: fixed;
  min-width: 180px;
  padding: 6px;
  background: #ffffff;
  border: 1px solid #d7dce5;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.16);
  z-index: 30;
  /* **不要**给这层加 overflow —— 二级菜单是它的绝对定位子节点，靠 left/right: 100%
     伸到菜单框外面。一旦这里 overflow 不是 visible：
       - 二级菜单被裁掉，点不中（这是实际踩到的 bug）；
       - 横向因为内容溢出，浏览器还会再给一条横向滚动条。
     装不下的问题交给 contextMenuTop() 的「上翻 / 上移」解决，不靠滚动。 */
`;

const ContextMenuTitle = styled.div`
  padding: 6px 9px;
  color: #64748b;
  font-size: 0.72rem;
  border-bottom: 1px solid #eef1f5;
`;

const ContextMenuItemButton = styled.button`
  display: block;
  width: 100%;
  padding: 8px 9px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: #1f2937;
  text-align: left;
  cursor: pointer;
  font-size: 0.8rem;

  &:hover:not(:disabled) {
    background: #eff6ff;
    color: #2563eb;
  }

  &:disabled {
    color: #94a3b8;
    cursor: default;
  }
`;

// 二级菜单的父项。展开时保持高亮，「这一项下面还有东西」才看得出来。
const ContextMenuGroupButton = styled(ContextMenuItemButton)<{ $open?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;

  ${({ $open }) => $open && 'background: #eff6ff; color: #2563eb;'}
`;

// 父项 + 子菜单的容器。子菜单是它的 DOM 子节点，鼠标从父项滑进子项不会触发 leave，
// 所以「悬停展开」不会在移动过程中自己关掉。
const ContextMenuGroup = styled.div`
  position: relative;
`;

const ContextMenuArrow = styled.span`
  color: #94a3b8;
  font-size: 0.7rem;
`;

const ContextSubMenu = styled.div<{ $flip?: boolean }>`
  position: absolute;
  top: -6px;
  ${({ $flip }) => ($flip ? 'right: 100%;' : 'left: 100%;')}
  min-width: 132px;
  padding: 6px;
  background: #ffffff;
  border: 1px solid #d7dce5;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.16);
  z-index: 31;
`;

const ControlsOverlay = styled.div<{ $collapsed?: boolean }>`
  position: absolute;
  top: 10px;
  right: 10px;
  background-color: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(5px);
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  /* 收起时只剩一个按钮，内边距和圆角跟着收小，看起来就是「一个小方块」 */
  padding: ${({ $collapsed }) => ($collapsed ? '4px' : '8px')};
  z-index: 10;
  /* 两行竖排：第一行是运行/视图操作，第二行是全屏/导出/收起 */
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: ${({ $collapsed }) => ($collapsed ? '0' : '4px')};
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
`;

// 工具栏里的一行。右对齐 —— 两行按钮数不一样（5 / 4），左对齐会让右边参差不齐。
const ControlRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
`;

interface IconButtonProps {
  $active?: boolean;
}

const IconButton = styled.button<IconButtonProps>`
  width: 30px;
  height: 30px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: ${({ $active }) => $active ? 'rgba(225, 29, 72, 0.12)' : 'transparent'};
  color: ${({ $active }) => $active ? '#e11d48' : '#333'};
  cursor: pointer;
  font-size: 1.15rem;
  display: flex;
  align-items: center;
  justify-content: center;

  /* 必须带 :not(:disabled) —— 否则置灰的按钮悬停时照样会亮成蓝色，
     看起来像能点。 */
  &:hover:not(:disabled) {
    background-color: rgba(0, 122, 255, 0.1);
    color: #007aff;
  }

  &:disabled {
    color: #c8ccd4;
    cursor: not-allowed;
    background: transparent;
  }
`;


export default GeometryCanvas;
