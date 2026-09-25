// 画布左键拖动应该做什么。抽成纯函数，保证 mousedown 和 mousemove
// 两处判断不会各写一遍而逐渐走偏，也方便直接做真值表回归测试。
export type CanvasDragMode =
    // 平移整个绘图区（闭锁状态，或开锁状态下没有命中任何元素）
    | 'pan'
    // 拖动几何标签
    | 'label'
    // 拖动可直接改坐标的点 / 文本
    | 'object'
    // 命中了元素但不能拖动（例如圆、线），这次拖动不做任何事
    | 'none';

export type DragSelection =
    | { kind: 'label'; id: string }
    | { kind: 'object'; name: string }
    | null;

/**
 * 决定一次左键拖动对应的操作。
 *
 * - 闭锁状态：始终平移视图。
 * - 开锁状态命中标签：拖动标签。
 * - 开锁状态命中可直接拖动的点 / 文本：拖动元素。
 * - 开锁状态没有命中任何元素：和闭锁状态一样平移视图。
 * - 开锁状态命中其它元素：不拖动（避免误改圆、线等对象）。
 */
export function resolveCanvasDragMode(
    isLocked: boolean,
    selection: DragSelection,
    draggableObjectName: string | null,
): CanvasDragMode {
    if (isLocked) return 'pan';
    if (!selection) return 'pan';
    if (selection.kind === 'label') return 'label';
    if (draggableObjectName !== null && draggableObjectName === selection.name) return 'object';
    return 'none';
}

/**
 * 决定一次滚轮事件是否应该缩放视图。
 *
 * - 闭锁状态：始终缩放。闭锁下不参与元素交互，所以光标在哪都一样。
 * - 开锁状态：光标压在元素（点、文本或标签）上时不缩放，避免在元素附近误改视图比例；
 *   空白处仍然缩放。
 *
 * `hoveringElement` 由调用方用与 hover / 拖动同一套容差做命中测试得到，
 * 保证「挡住滚轮的东西」和「点得到的东西」是同一批。
 */
export function resolveWheelZoom(isLocked: boolean, hoveringElement: boolean): boolean {
    if (isLocked) return true;
    return !hoveringElement;
}

/**
 * 命中元素是否可以被左键拖动改坐标。
 *
 * - 点 / 文本可以直接拖动；圆、线等其它几何对象不行（只能选中）。
 * - 点带 `frozen=true` 时即使类型允许也拒绝拖动，对应 `CREATE POINT ... frozen=true`。
 *
 * 结果直接决定 `draggedObjectNameRef` 是否赋值，进而决定 resolveCanvasDragMode
 * 返回 'object' 还是 'none'，所以冻结点会走「命中了但不能拖动」这条路。
 *
 * **冻结只影响拖动，不影响光标**：冻结点照样能点选、照样能平移视图，
 * 所以 hover 光标仍是 `pointer`，不要为了「提示拖不动」去改成 `not-allowed`。
 * 判据是「这个元素还能不能被点中」—— 能，就不该显示禁止光标。
 */
export function isDraggableElement(element: { type: string; frozen?: boolean } | null | undefined): boolean {
    if (!element) return false;
    if (element.type !== 'point' && element.type !== 'text') return false;
    return element.frozen !== true;
}
