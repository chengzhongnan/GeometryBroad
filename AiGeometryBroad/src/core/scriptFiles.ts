// 脚本文件树的纯逻辑。
//
// 抽出来有两个原因：
// 1. 这些操作（找父文件夹 / 收集文件名 / 按 `geo_<数字>` 选新名 / 插入节点）都是纯函数，
//    不碰 React 也不碰 localStorage，独立出来才能脱离浏览器回归；
// 2. 「保存脚本 = 在树里新建一份 geo_N.geo」这个约定要有一处**唯一实现**，
//    不然组件里再拼一份迟早和平铺的编号规则走偏。

/** 文件树节点：文件有 content，文件夹有 children。与 TreeNode.tsx 的 FileNodeData 同构。 */
export interface ScriptFileNode {
    id: string;
    name: string;
    type: 'file' | 'folder';
    content?: string;
    children?: ScriptFileNode[];
}

/**
 * 找出某个节点所在的文件夹 id；节点直接在根层时返回 null。
 *
 * 「找到」用 `undefined` 与 `null` 区分：`null` 是合法结果（在根层），
 * `undefined` 表示这一支没找到、还要继续搜。
 */
export function findParentFolderId(nodes: ScriptFileNode[], nodeId: string): string | null {
    const search = (list: ScriptFileNode[], parentId: string | null): string | null | undefined => {
        for (const node of list) {
            if (node.id === nodeId) return parentId;
            if (node.children) {
                const found = search(node.children, node.id);
                if (found !== undefined) return found;
            }
        }
        return undefined;
    };
    return search(nodes, null) ?? null;
}

/** 收集整棵树里所有文件的名字（用于给新文件挑一个没被占用的编号）。 */
export function collectFileNames(nodes: ScriptFileNode[]): string[] {
    const names: string[] = [];
    for (const node of nodes) {
        if (node.type === 'file') names.push(node.name);
        if (node.children) names.push(...collectFileNames(node.children));
    }
    return names;
}

/**
 * 按 `<前缀>_<数字>` 规则取下一个未被占用的名字（数字从 1 开始）。
 *
 * 比较时统一转小写，避免 `Geo_1` 和 `geo_1` 在同一个树里并存 ——
 * 多数文件系统大小写不敏感，放进来就是潜在的重名。
 */
export function nextSequentialFileName(
    nodes: ScriptFileNode[],
    prefix: string,
    extension: string,
): string {
    const taken = new Set(collectFileNames(nodes).map(name => name.toLowerCase()));
    let index = 1;
    // 上限只是防止极端情况下死循环；正常一两个来回就命中空位。
    while (index < 100000) {
        const candidate = `${prefix}_${index}${extension}`;
        if (!taken.has(candidate.toLowerCase())) return candidate;
        index += 1;
    }
    return `${prefix}_${Date.now()}${extension}`;
}

/** 往指定文件夹（folderId 为 null 表示根层）追加一个节点，返回新树。 */
export function insertNodeIntoTree(
    nodes: ScriptFileNode[],
    folderId: string | null,
    newNode: ScriptFileNode,
): ScriptFileNode[] {
    if (folderId === null) return [...nodes, newNode];
    return nodes.map(node => {
        if (node.id === folderId && node.type === 'folder') {
            return { ...node, children: [...(node.children || []), newNode] };
        }
        if (node.children) {
            return { ...node, children: insertNodeIntoTree(node.children, folderId, newNode) };
        }
        return node;
    });
}

/** 在树中按 id 查找一个文件节点；找不到返回 null。 */
export function findFileNode(nodes: ScriptFileNode[], fileId: string): ScriptFileNode | null {
    for (const node of nodes) {
        if (node.id === fileId && node.type === 'file') return node;
        if (node.children) {
            const match = findFileNode(node.children, fileId);
            if (match) return match;
        }
    }
    return null;
}
