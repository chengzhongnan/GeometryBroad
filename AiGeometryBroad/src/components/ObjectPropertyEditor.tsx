import React from 'react';
import styled from 'styled-components';
import type { ObjectPropertyKey, VariableInfo } from '../core/DSLInterpreter';
import type { PropertySyncOptions } from '../core/dslPropertySync';

/**
 * 单个对象的属性编辑器。
 *
 * 从右侧 OutputPanel 里抽出来，因为「右键对象 → 编辑对象」的弹窗要用**同一套**编辑能力：
 * 数值属性、标签、截止点（含画布点选）。两处各写一份的话，以后给属性加一种类型
 * （比如布尔开关）就会只加在一处，用户会发现「面板里能改、弹窗里改不了」。
 *
 * 两处的底色不一样（面板深色、弹窗浅色），但结构完全共用。配色用「按变体生成一套
 * styled 组件」的做法而不是 ThemeProvider：
 *   - ThemeProvider 要求给 styled-components 的 `DefaultTheme` 做全局 module augmentation，
 *     那会让**所有** styled 组件的 theme 都变成这套配色，代价太大；
 *   - 按变体各生成一套、放在模块级缓存里，组件身份稳定（在渲染期现场生成会让
 *     每次渲染都换新组件类型 → React 卸载重挂 → 输入框打字时丢焦点）。
 */
export interface ObjectPropertyEditorHandlers {
    onObjectPropertyChange: (
        name: string,
        changes: Partial<Record<ObjectPropertyKey, number>>,
        options?: PropertySyncOptions,
    ) => void;
    /** 截止点：整串值写回 `cutPoints=`（例如 `-A,+B`）。 */
    onCutPointsChange: (name: string, value: string, lineNumber?: number) => void;
    /** 标签：整串文本写回 `label=`；空串表示不显示标签（把参数删掉）。 */
    onLabelChange: (name: string, value: string, lineNumber?: number) => void;
    /** 进入画布点选：点到的点会以 `sign` 指定的方向追加为截止点。 */
    onPickCutPoint: (name: string, sign: '+' | '-') => void;
}

export type EditorVariant = 'dark' | 'light';

export interface ObjectPropertyEditorProps {
    object: VariableInfo;
    handlers: ObjectPropertyEditorHandlers;
    /** `dark` = 右侧面板，`light` = 弹窗。 */
    variant?: EditorVariant;
    /**
     * 是否显示「对象名 · 类型」那一行。
     * 弹窗的标题栏已经写了，再重复一遍是噪音，所以传 false。
     */
    showTitle?: boolean;
}

interface EditorPalette {
    cardBorder: string;
    cardBackground: string;
    titleColor: string;
    sectionTitleColor: string;
    labelColor: string;
    detailLabelColor: string;
    detailValueColor: string;
    inputBorder: string;
    inputBackground: string;
    inputColor: string;
    focusColor: string;
    buttonBorder: string;
    buttonColor: string;
    buttonHoverBorder: string;
    buttonHoverColor: string;
}

const PALETTES: Record<EditorVariant, EditorPalette> = {
    dark: {
        cardBorder: '#4b5563',
        cardBackground: 'rgba(0, 0, 0, 0.12)',
        titleColor: '#f9fafb',
        sectionTitleColor: '#a5b4fc',
        labelColor: '#cbd5e1',
        detailLabelColor: '#9ca3af',
        detailValueColor: '#e5e7eb',
        inputBorder: '#64748b',
        inputBackground: '#111827',
        inputColor: '#f9fafb',
        focusColor: '#818cf8',
        buttonBorder: '#6b7280',
        buttonColor: '#d1d5db',
        buttonHoverBorder: '#a5b4fc',
        buttonHoverColor: '#ffffff',
    },
    light: {
        cardBorder: '#e2e8f0',
        cardBackground: '#f8fafc',
        titleColor: '#1f2937',
        sectionTitleColor: '#4338ca',
        labelColor: '#475569',
        detailLabelColor: '#64748b',
        detailValueColor: '#0f172a',
        inputBorder: '#d7dce5',
        inputBackground: '#ffffff',
        inputColor: '#1f2937',
        focusColor: '#2563eb',
        buttonBorder: '#cbd5e1',
        buttonColor: '#475569',
        buttonHoverBorder: '#2563eb',
        buttonHoverColor: '#1f2937',
    },
};

/** 按配色生成一整套 styled 组件。只在模块加载时各跑一次。 */
function createStyles(c: EditorPalette) {
    const inputBase = `
        box-sizing: border-box;
        padding: 0.2rem 0.3rem;
        border: 1px solid ${c.inputBorder};
        border-radius: 3px;
        background: ${c.inputBackground};
        color: ${c.inputColor};
        font: inherit;
        font-size: 0.72rem;

        &:focus {
            outline: 1px solid ${c.focusColor};
            border-color: ${c.focusColor};
        }

        &:disabled {
            cursor: not-allowed;
            opacity: 0.45;
        }
    `;

    return {
        Card: styled.div`
            margin-top: 0.5rem;
            padding: 0.6rem 0.65rem;
            border: 1px solid ${c.cardBorder};
            border-radius: 4px;
            background: ${c.cardBackground};
        `,
        CardTitle: styled.div`
            color: ${c.titleColor};
            font-size: 0.78rem;
            font-weight: bold;
            margin-bottom: 0.45rem;
        `,
        /**
         * 只读信息（type / position.x / radius …）的排布。
         *
         * 以前是一行一项、整行铺满，属性栏收窄之后会拉成又长又稀的一列。
         * 改成按可用宽度自动分栏：每个格子窄一点，但一行能放好几个，
         * 信息一行不少而整体更短。
         */
        DetailGrid: styled.div`
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
            column-gap: 14px;
        `,
        DetailRow: styled.div`
            display: flex;
            justify-content: space-between;
            gap: 0.75rem;
            min-width: 0;
            padding: 0.18rem 0;
            color: ${c.detailLabelColor};
            font-size: 0.72rem;

            span {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            strong {
                color: ${c.detailValueColor};
                font-weight: 400;
                white-space: nowrap;
            }
        `,
        EditableBlock: styled.div`
            margin-top: 0.7rem;
            padding-top: 0.55rem;
            border-top: 1px solid ${c.cardBorder};
        `,
        EditableTitle: styled.div`
            margin-bottom: 0.4rem;
            color: ${c.sectionTitleColor};
            font-size: 0.68rem;
        `,
        PropertyRow: styled.div`
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 0.5rem;
            margin-bottom: 0.35rem;
        `,
        PropertyLabel: styled.span`
            color: ${c.labelColor};
            font-size: 0.72rem;
        `,
        PropertyInput: styled.input`
            width: 84px;
            ${inputBase}
        `,
        // 标签是自由文本（「点 P」「直线 l」甚至 `$LaTeX$`），比数值宽一些才够用。
        LabelTextInput: styled.input`
            width: 128px;
            ${inputBase}
        `,
        // 截止点是「一串点名 + 方向」，一行放不下标签、输入框和三个按钮，
        // 所以单独排成「标签/按钮在上、输入框占满整行」的两行结构。
        CutPointRow: styled.div`
            margin-bottom: 0.35rem;
        `,
        CutPointHeader: styled.div`
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 0.5rem;
            margin-bottom: 0.25rem;
        `,
        CutPointButtons: styled.div`
            display: flex;
            gap: 0.25rem;
            flex-shrink: 0;
        `,
        CutPointButton: styled.button`
            border: 1px solid ${c.buttonBorder};
            background: transparent;
            color: ${c.buttonColor};
            border-radius: 4px;
            padding: 0.12rem 0.3rem;
            font-family: inherit;
            font-size: 0.66rem;
            cursor: pointer;
            white-space: nowrap;

            &:hover {
                border-color: ${c.buttonHoverBorder};
                color: ${c.buttonHoverColor};
            }
        `,
        CutPointInput: styled.input`
            width: 100%;
            ${inputBase}
        `,
    };
}

const STYLES: Record<EditorVariant, ReturnType<typeof createStyles>> = {
    dark: createStyles(PALETTES.dark),
    light: createStyles(PALETTES.light),
};

const ObjectPropertyEditor: React.FC<ObjectPropertyEditorProps> = ({
    object,
    handlers,
    variant = 'dark',
    showTitle = true,
}) => {
    const { onObjectPropertyChange, onCutPointsChange, onLabelChange, onPickCutPoint } = handlers;
    const S = STYLES[variant];
    const cutPoints = object.editableCutPoints;
    const label = object.editableLabel;
    const hasEditableProperties = Boolean(object.editableProperties && object.editableProperties.length > 0);
    const lineNumber = object.editableProperties?.[0]?.lineNumber ?? cutPoints?.lineNumber ?? label?.lineNumber;
    const hasAnythingToEdit = hasEditableProperties || Boolean(cutPoints) || Boolean(label);

    return (
        <S.Card>
            {showTitle && <S.CardTitle>{object.name} · {object.objectType}</S.CardTitle>}
            <S.DetailGrid>
                {Object.entries(object.details || {}).map(([key, value]) => (
                    <S.DetailRow key={key}>
                        <span title={key}>{key}</span>
                        <strong>{value}</strong>
                    </S.DetailRow>
                ))}
            </S.DetailGrid>
            {hasAnythingToEdit && (
                <S.EditableBlock>
                    {/* 自动派生的对象（TANGENT 的 T2 / T2_tan 等）在脚本里没有独立定义行，
                        解释器给的行号是 0。显示「第 0 行」只会让人以为坏了，改成说明性文案。 */}
                    <S.EditableTitle>
                        {lineNumber
                            ? `可编辑属性 · 第 ${lineNumber} 行`
                            : '可编辑属性 · 自动派生对象（标签由 SETLABEL 写入）'}
                    </S.EditableTitle>
                    {object.editableProperties?.map(property => (
                        <S.PropertyRow key={property.key}>
                            <S.PropertyLabel title={property.reason}>{property.label}</S.PropertyLabel>
                            <S.PropertyInput
                                // key 带上当前值：脚本重跑后属性变了就重建输入框，
                                // 免得它一直显示上一轮的数字。
                                key={`${property.key}-${property.value}`}
                                type="number"
                                step="any"
                                defaultValue={property.value}
                                disabled={!property.editable}
                                title={property.reason || '修改后同步回 DSL 代码'}
                                onBlur={event => {
                                    const nextValue = Number(event.currentTarget.value);
                                    if (property.editable && Number.isFinite(nextValue)) {
                                        onObjectPropertyChange(
                                            object.name,
                                            { [property.key]: nextValue },
                                            { lineNumber: property.lineNumber },
                                        );
                                    }
                                }}
                                onKeyDown={event => {
                                    if (event.key === 'Enter') event.currentTarget.blur();
                                }}
                            />
                        </S.PropertyRow>
                    ))}
                    {label && (
                        // 标签是字符串，所以走 onLabelChange 而不是 onObjectPropertyChange（后者只收数值）。
                        // 输入框受控于 defaultValue + key：值变了就重建，避免把用户没提交的输入冲掉。
                        <S.PropertyRow>
                            <S.PropertyLabel title={label.reason}>{label.label}</S.PropertyLabel>
                            <S.LabelTextInput
                                key={`label-${label.value}`}
                                type="text"
                                defaultValue={label.value}
                                placeholder="留空 = 不显示"
                                spellCheck={false}
                                disabled={!label.editable}
                                title={label.reason || '修改后同步回 DSL 代码'}
                                onBlur={event => {
                                    if (label.editable) {
                                        onLabelChange(object.name, event.currentTarget.value, label.lineNumber);
                                    }
                                }}
                                onKeyDown={event => {
                                    if (event.key === 'Enter') event.currentTarget.blur();
                                }}
                            />
                        </S.PropertyRow>
                    )}
                    {cutPoints && (
                        <S.CutPointRow>
                            <S.CutPointHeader>
                                <S.PropertyLabel title={cutPoints.reason}>{cutPoints.label}</S.PropertyLabel>
                                <S.CutPointButtons>
                                    {/* 点选后写 `+P`：砍掉 P 正方向那一侧，保留到 P 为止。 */}
                                    <S.CutPointButton
                                        type="button"
                                        title="在画布上点一个点，写成 +P：隐藏它的正方向一侧"
                                        onClick={() => onPickCutPoint(object.name, '+')}
                                    >
                                        + 点选
                                    </S.CutPointButton>
                                    {/* 点选后写 `-P`：砍掉 P 负方向那一侧，从 P 开始保留。两个点各选一次就是线段。 */}
                                    <S.CutPointButton
                                        type="button"
                                        title="在画布上点一个点，写成 -P：隐藏它的负方向一侧"
                                        onClick={() => onPickCutPoint(object.name, '-')}
                                    >
                                        − 点选
                                    </S.CutPointButton>
                                    <S.CutPointButton
                                        type="button"
                                        title="清空截止点，恢复成完整的直线 / 射线"
                                        onClick={() => onCutPointsChange(object.name, '', cutPoints.lineNumber)}
                                    >
                                        清空
                                    </S.CutPointButton>
                                </S.CutPointButtons>
                            </S.CutPointHeader>
                            <S.CutPointInput
                                key={`cutPoints-${cutPoints.value}`}
                                type="text"
                                defaultValue={cutPoints.value}
                                placeholder="例如 -A,+B"
                                spellCheck={false}
                                disabled={!cutPoints.editable}
                                title={cutPoints.reason}
                                onBlur={event => {
                                    if (cutPoints.editable) {
                                        onCutPointsChange(object.name, event.currentTarget.value, cutPoints.lineNumber);
                                    }
                                }}
                                onKeyDown={event => {
                                    if (event.key === 'Enter') event.currentTarget.blur();
                                }}
                            />
                        </S.CutPointRow>
                    )}
                </S.EditableBlock>
            )}
        </S.Card>
    );
};

export default ObjectPropertyEditor;
