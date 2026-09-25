import React, { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import styled from 'styled-components';
import { FiMaximize, FiDownload, FiCopy, FiLock, FiUnlock, FiRotateCw } from 'react-icons/fi';
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
    CREATE_SHAPE_CATALOG,
    describePickOperation,
    getPickOperationsForAnchor,
    isLinearType,
    isPointType,
    listLinearPieces,
    PICK_OPERATION_LABELS,
    planLinearPieceRemoval,
    planSelectionOperation,
    planCircleOperation,
    projectOntoLinear,
    type CommandBuildContext,
    type CreateShapeCatalogEntry,
    type CreateShapeKind,
    type CreateTextSpec,
    type LinearPiece,
    type ObjectRef,
    type PickOperation,
    type PickOperationSpec,
    type Point2D,
    type SelectionOperation,
    type CircleOperation,
} from '../core/geometryCommandBuilder';
import { parseTextCommandLine, rewriteTextCommandLine } from '../core/textObjectEditing';

// 命中测试的像素容差。hover 光标提示、左键拖动、滚轮缩放守卫全部共用这一个值，
// 避免同一个「算不算命中」的判断散落成几个字面量后逐渐走偏。
const HIT_TOLERANCE = 12;

/**
 * 空选右键新建图形的默认尺寸（屏幕像素）。
 *
 * 存的是像素而不是逻辑长度：逻辑长度会随缩放变化，存死数字的话放大到 5 倍时
 * 新建的图形只有指甲盖大。右键那一刻按当前变换折算成逻辑长度，才能「看起来一样大」。
 */
const CREATE_SHAPE_SIZE_PX = 80;

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
    /** 打开「修改标签」对话框。 */
    editLabel?: boolean;
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

/** 选择对话框的状态；targetName 为 null 表示用户还没在图形里点选目标。 */
type PickDialogState = PickOperationSpec;

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
 * `index` 只用来画高亮；`t` / `point` 是同一份投影结果，交给删除逻辑按
 * 「离鼠标最近的已知点」重算真正要删的那一段（无界尾部会用到 `point` 生成边界点）。
 */
interface TrimHover {
    index: number;
    t: number;
    point: Point2D;
}

interface GeometryCanvasProps {
    width: number;
    height: number;
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

const GeometryCanvas: React.FC<GeometryCanvasProps> = ({ width, height, script, revision, onGeometryMessage, onClearMessage, frozenRandomVariables, frozenRandomObjects, selectedObjectNames, selectedLabelId, labelPositions, onSelectObject, onSelectLabel, onLabelPositionChange, onObjectPropertyChange, onLabelChange, onGeometryCommands, onDeleteObjects, onTextLineChange, onDeleteText, onLinearTrim, cutPointPick, onCutPointPicked, onCancelCutPointPick, onVariablesChange }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const interpreterRef = useRef<GeometryDSLInterpreter | null>(null);

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
    const suppressClickRef = useRef(false);
    // 「截取线段」的选择会话。用 ref 是为了让画布事件处理函数和 redraw 都读到最新值，
    // state 只负责驱动提示条重渲染（和 isLocked / isLockedRef 的分工一致）。
    const trimSessionRef = useRef<TrimSession | null>(null);
    const trimHoverRef = useRef<number | null>(null);
    const exitTrimModeRef = useRef<() => void>(() => {});
    const commitTrimPieceRef = useRef<(tMouse: number, mousePoint: Point2D) => void>(() => {});
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
            // 重新执行脚本
            interpreter.execute(script);
            onVariablesChange(interpreter.getVariables());

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
        } catch (error) {
            console.error("Error during redraw:", error);
        }
    }, [script, frozenRandomVariables, frozenRandomObjects, selectedObjectNames, selectedLabelId, labelPositions, onVariablesChange, katexTick]); // 选中对象、标签位置或固定状态变化时重绘

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
            isReferenceablePoint: name => interpreter?.getSourceLineForObject(name) !== null,
        };
    }, [script]);

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
                    const changedX = interpreterRef.current.previewObjectPropertyChange(objectName, 'x', nextX);
                    const changedY = interpreterRef.current.previewObjectPropertyChange(objectName, 'y', nextY);
                    if (changedX && changedY) {
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
                const element = interpreterRef.current.getEditableElementPosition(draggedName);
                if (element) {
                    // 带上渲染时记录的源码行号，保证同步回 DSL 时改的是同一行。
                    onObjectPropertyChange(
                        draggedName,
                        { x: element.x, y: element.y },
                        { lineNumber: interpreterRef.current.getSourceLineForObject(draggedName) },
                    );
                }
                interpreterRef.current.clearPreviewObjectProperties(draggedName);
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
         * 除了段号，这里还把鼠标投影到线上的参数 `t` 和投影点一起返回 ——
         * 高亮按 `t` 落在哪段来定，但真正删哪一段由 `planLinearPieceRemoval`
         * 按「离鼠标最近的已知点」重算，两者必须是同一份投影结果，
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

            // 投影点（逻辑坐标）—— 生成边界点时要拿它反过来算参数，也用不到端点钳制。
            const projected = { x: p1.x + t * dx, y: p1.y + t * dy };

            for (let i = 0; i < session.pieces.length; i++) {
                const piece = session.pieces[i];
                const lo = piece.startT ?? -Infinity;
                const hi = piece.endT ?? Infinity;
                if (t >= lo && t <= hi) return { index: i, t, point: projected };
            }
            return null;
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
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            if (cutPointPickRef.current) {
                onCancelCutPointPick();
                return;
            }
            if (trimSessionRef.current) exitTrimModeRef.current();
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
                if (hover) commitTrimPieceRef.current(hover.t, hover.point);
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

            const objects: ObjectRef[] = objectNames
                .map(name => {
                    const object = interpreterRef.current?.getObject(name);
                    return object ? { name: object.name, type: object.type } : null;
                })
                .filter((item): item is ObjectRef => item !== null);

            const items: ContextMenuItem[] = [];
            let title = `${objects.length} 个对象`;

            // 解释器解析好的顶层指令表：判断「能不能删/能不能裁」要用它，
            // 点下去时也把它一起交给上层做脚本改写（上层没有解释器实例）。
            const commands = interpreterRef.current.getTopLevelCommands();

            if (objects.length === 1) {
                // 单个对象：菜单内容由「这个类型支持哪些作图」决定。
                // 这些操作都需要先弹对话框（再点一个目标或填参数），所以不是直接作图。
                const [anchor] = objects;
                const operations = getPickOperationsForAnchor(anchor.type);
                if (operations.length > 0) {
                    title = anchor.type === 'point' ? `点 ${anchor.name}` : `${anchor.name}`;
                    items.push(...operations.map(operation => ({
                        id: operation,
                        label: PICK_OPERATION_LABELS[operation],
                        pickOperation: operation,
                    })));
                }

                // 截取：进入选择模式，鼠标在线上移动时高亮光标所在的那一段，单击删掉它。
                // 段的分界全部来自线上已有的点，所以生成的对象能随原图形一起变化。
                // 能切出几段是算出来的，一段都切不出来（比如线段上还没取点）就置灰说明原因。
                if (isLinearType(anchor.type)) {
                    const pieceSet = listLinearPieces(
                        { anchorName: anchor.name, anchorType: anchor.type },
                        buildContext(),
                    );
                    items.push({
                        id: 'trim',
                        label: '截取线段（选要删除的一段）',
                        title: pieceSet.blocked,
                        trimMode: true,
                        disabled: Boolean(pieceSet.blocked),
                    });
                }

                // 改标签：名字是给引用用的标识符（自动生成的还是 `perp1` 这种），
                // 想让它出现在图上就显式设一个标签。
                //
                // 解释器现在对**所有**已注册对象都返回一条记录（editable 恒为 true）：
                // 有可挂的 `label=` 就改那一行，没有的地方（`CREATE TANGENT` 顺带建出的
                // `T2` / `T2_tan` 之类）就用 SETLABEL 指令兜底。所以这里不再需要置灰。
                const labelProperty = interpreterRef.current?.getEditableLabel(anchor.name);
                if (labelProperty) {
                    items.push({
                        id: 'editLabel',
                        label: '修改标签…',
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
                    const textInfo = interpreterRef.current?.getEditableText(anchor.name);
                    if (textInfo) {
                        items.push({
                            id: 'editText',
                            label: '编辑文字…',
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
                            label: '删除文字',
                            title: '删除脚本里这条 TEXT 指令',
                            deleteTextLine: textInfo.lineNumber,
                            disabled: !textInfo.editable,
                        });
                    }
                }

                // 选中一个圆：圆周最近点 / 圆心 / 切线 / 法线。都即时生成，不需要对话框。
                if (anchor.type === 'circle') {
                    for (const [id, label, hint] of [
                        ['pointOnCircle', '在圆周上创建点（离鼠标最近）', '在圆周上离右键处最近的位置生成一点'],
                        ['circleCenter', '创建圆心', '生成这个圆的圆心点'],
                        ['tangent', '过该点作切线', '过圆周上离鼠标最近的点作圆的切线'],
                        ['normal', '过该点作法线', '过圆周上离鼠标最近的点作圆的法线（即过圆心与该点的直线）'],
                    ] as const) {
                        const plan = planCircleOperation(id, anchor, anchorPoint, buildContext());
                        items.push({
                            id,
                            label,
                            title: plan.blocked ?? hint,
                            circleOperation: id,
                            disabled: Boolean(plan.blocked),
                        });
                    }
                    // 上面那条切线的切点是「鼠标最近处」，这里再给一个显式挑点的入口：
                    // 圆外一个已经画好的点 → 过它作切线。需要先弹对话框点选那个点。
                    items.push({
                        id: 'tangentToCircle',
                        label: '过某个已有点作切线…',
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
                    items.push(
                        { id: 'segment', label: '连接线段', selectionOperation: 'segment' },
                        { id: 'line', label: '连接直线', selectionOperation: 'line' },
                        { id: 'perpBisector', label: '作垂直平分线', selectionOperation: 'perpBisector' },
                    );
                } else if (pointRef && circleRef) {
                    // 一个点 + 一个圆：过该点作圆的切线（并标出切点）。
                    // 点在圆内时做不出来，置灰并说明原因。
                    const plan = planSelectionOperation('pointCircleTangent', objects, buildContext());
                    const count = plan.newPointCount ?? 0;
                    items.push({
                        id: 'pointCircleTangent',
                        label: count === 1
                            ? '过该点作圆的切线（切点在该点上）'
                            : '过该点作圆的切线（作两条，标出切点）',
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
                    items.push({
                        id: 'lineCircleIntersect',
                        label: count === 1 ? '求线与圆的交点（补建 1 个点）' : '求线与圆的交点',
                        title: plan.blocked ?? defaultHint,
                        selectionOperation: 'lineCircleIntersect',
                        disabled: Boolean(plan.blocked),
                    });
                } else if (
                    (isPointType(first.type) && isLinearType(second.type))
                    || (isLinearType(first.type) && isPointType(second.type))
                ) {
                    items.push({ id: 'perpendicular', label: '过点作垂线', selectionOperation: 'perpendicular' });
                } else if (isLinearType(first.type) && isLinearType(second.type)) {
                    // 两条线选中时最常见的诉求就是求交点，直接给出来。
                    items.push({ id: 'intersect', label: '求两条线的交点', selectionOperation: 'intersect' });
                    // 角平分线 / 平行四边形都要求两条线共端点，所以共用同一个判定：
                    // 共不了端点时置灰并把原因写在悬停提示里（比如「两条线没有公共端点」）。
                    for (const [id, label] of [
                        ['angleBisector', '作角平分线（第一条 → 第二条）'],
                        ['parallelogram', '以这两条边作平行四边形'],
                    ] as const) {
                        const plan = planSelectionOperation(id, objects, buildContext());
                        items.push({
                            id,
                            label,
                            title: plan.blocked ?? (id === 'angleBisector'
                                ? '从第一条线转向第二条线的方向作角平分线'
                                : '以公共端点为顶点、这两条边为邻边补全平行四边形'),
                            selectionOperation: id,
                            disabled: Boolean(plan.blocked),
                        });
                    }
                } else if (first.type === 'circle' && second.type === 'circle') {
                    // 两个圆：求交点。最多两个交点；若其中一个已经有点落在上面，只补建另一个。
                    const plan = planSelectionOperation('circleIntersect', objects, buildContext());
                    const count = plan.newPointCount ?? 0;
                    const defaultHint = count === 1
                        ? '两圆有两个交点，但其中一个已经存在，只创建缺少的那个点'
                        : count === 2
                            ? '创建两圆的全部两个交点'
                            : '创建两圆的交点';
                    items.push({
                        id: 'circleIntersect',
                        label: count === 1 ? '求两圆交点（补建 1 个点）' : '求两圆交点',
                        title: plan.blocked ?? defaultHint,
                        selectionOperation: 'circleIntersect',
                        disabled: Boolean(plan.blocked),
                    });
                }
            } else if (objects.length === 3 && objects.every(item => isPointType(item.type))) {
                // 三个点：三角形、外接圆、内切圆。三点共线时三者都做不出来，
                // 置灰并说明原因，别让用户点下去得到一个退化的图形。
                for (const [id, label, hint] of [
                    ['triangle', '作三角形', '依次连接这三个点'],
                    ['circumcircle', '作外接圆', '过这三个点的圆（圆心是三条边中垂线的交点）'],
                    ['incircle', '作内切圆', '与三条边都相切的圆（圆心是三条角平分线的交点）'],
                ] as const) {
                    const plan = planSelectionOperation(id, objects, buildContext());
                    items.push({
                        id,
                        label,
                        title: plan.blocked ?? hint,
                        selectionOperation: id,
                        disabled: Boolean(plan.blocked),
                    });
                }
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

            setContextMenu({
                x: e.clientX - bounds.left,
                y: e.clientY - bounds.top,
                title,
                objects,
                items,
                anchorPoint,
            });
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
            if (!isLockedRef.current && interpreterRef.current && !trimSessionRef.current) {
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
        setPickDialog({
            kind: operation,
            anchorName: object.name,
            anchorType: object.type,
            targetName: null,
            // 「在线上取点」需要它；其余操作用不到，留着也无害。
            anchorPoint,
            // 默认值来自描述符，避免「隐藏字段没有初始值 -> 生成代码时读到 undefined」。
            options: describePickOperation(operation, object.name, object.type).defaults,
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

    // 删掉鼠标所在的那一段。真正删哪一段由 planner 按「离鼠标最近的已知点」重算，
    // 这里只把鼠标在线上投影的位置（参数 t + 投影点）交下去。
    //
    // 鼠标落在无界尾部时 planner 会返回 preludeCommands（现场造一个边界点）：
    // 那些指令要先追加进脚本、并和 cutPoints 一起写回，所以走 onLinearTrim 的
    // 一次性入口，由上层把两件事合到同一次脚本更新里。
    const commitTrimPiece = useCallback((tMouse: number, mousePoint: Point2D) => {
        const session = trimSessionRef.current;
        const interpreter = interpreterRef.current;
        if (!session || !interpreter) return;
        const outcome = planLinearPieceRemoval({
            anchorName: session.anchorName,
            anchorType: session.anchorType,
            tMouse,
            mousePoint,
        }, buildContext());
        exitTrimMode();
        if (!outcome.plan) return;
        onLinearTrim({
            name: session.anchorName,
            results: outcome.plan.results,
            cutPointNames: outcome.plan.cutPointNames,
            preludeCommands: outcome.plan.preludeCommands,
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
    }, [script, revision]);

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

    // 右键菜单项的渲染。分类项（有 children）渲染成悬停展开的父项，叶子渲染成可点项。
    // 用递归而不是写死两层：目录以后再加一层子分类，这里不用改。
    const renderContextMenuItem = (menu: ContextMenuState, item: ContextMenuItem): React.ReactNode => {
        if (item.children && item.children.length > 0) {
            const open = openSubmenuId === item.id;
            // 菜单落在画布右半边时，二级菜单往左弹，否则会被画布边缘切掉。
            const flip = menu.x > width * 0.55;
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
                    } else if (item.editLabel) {
                        handleOpenLabelDialog(menu.objects[0]);
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
            <ControlsOverlay>
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
                <IconButton onClick={handleResetView} title="重置视图" aria-label="重置视图">
                    <FiMaximize />
                </IconButton>
                <IconButton onClick={handleExportSvg} title="导出 SVG 文件" aria-label="导出 SVG 文件">
                    <FiDownload />
                </IconButton>
                <IconButton onClick={handleCopySvg} title="复制 SVG 代码" aria-label="复制 SVG 代码">
                    <FiCopy />
                </IconButton>
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
                    <TrimHintMuted>Esc 或右键退出</TrimHintMuted>
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
            {contextMenu && (
                <ContextMenu
                    style={{ left: contextMenu.x, top: contextMenu.y }}
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
                    sourceCanvas={canvasRef.current}
                    canvasWidth={width}
                    canvasHeight={height}
                    commands={dialogCommands}
                    onPick={name => setPickDialog(previous => (previous ? { ...previous, targetName: name } : previous))}
                    onOptionChange={handleDialogOptionChange}
                    hitTest={handleDialogHitTest}
                    drawHighlight={handleDialogHighlight}
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
  position: absolute;
  min-width: 180px;
  padding: 6px;
  background: #ffffff;
  border: 1px solid #d7dce5;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.16);
  z-index: 30;
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

const ControlsOverlay = styled.div`
  position: absolute;
  top: 10px;
  right: 10px;
  background-color: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(5px);
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  padding: 8px;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 12px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);

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

  &:hover {
    background-color: rgba(0, 122, 255, 0.1);
    color: #007aff;
  }
`;


export default GeometryCanvas;
