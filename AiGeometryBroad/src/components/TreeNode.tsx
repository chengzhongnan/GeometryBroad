// TreeNode.tsx
import React, { useState } from 'react';
import styled from 'styled-components';
import { FaFolder, FaFolderOpen, FaFileCode } from 'react-icons/fa';

export interface FileNodeData {
    id: string;
    name: string;
    type: 'file' | 'folder';
    content?: string;      // 仅文件有
    children?: FileNodeData[]; // 仅文件夹有
  }

interface TreeNodeProps {
  node: FileNodeData;
  onSelectFile: (node: FileNodeData) => void;
  activeFileId: string | null;
  level: number;
  onContextMenu: (event: React.MouseEvent, node: FileNodeData) => void;
}

const TreeNode: React.FC<TreeNodeProps> = ({ node, onSelectFile, activeFileId, level, onContextMenu }) => {
  const [isOpen, setIsOpen] = useState(false);
  const isFolder = node.type === 'folder';
  const isActive = node.id === activeFileId;

  const handleToggle = () => {
    if (isFolder) {
      setIsOpen(!isOpen);
    } else {
      onSelectFile(node);
    }
  };

  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault(); // 阻止默认浏览器菜单
    event.stopPropagation(); // 阻止事件冒泡到父级
    onContextMenu(event, node);
  };

  return (
    <>
      <NodeWrapper onClick={handleToggle} level={level} isActive={isActive}>
        {isFolder ? (
          isOpen ? <FaFolderOpen /> : <FaFolder />
        ) : (
          <FaFileCode />
        )}
        <NodeName>{node.name}</NodeName>
      </NodeWrapper>
      {isFolder && isOpen && (
        <div>
          {node.children?.map(childNode => (
            <TreeNode
              key={childNode.id}
              node={childNode}
              onContextMenu={handleContextMenu}
              onSelectFile={onSelectFile}
              activeFileId={activeFileId}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </>
  );
};

// --- Styles ---
const NodeWrapper = styled.div<{ level: number; isActive: boolean }>`
  display: flex;
  align-items: center;
  padding: 4px 8px;
  padding-left: ${props => props.level * 20 + 8}px; /* 核心：实现缩进 */
  cursor: pointer;
  font-size: 15px;
  color: #cccccc;
  background-color: ${props => props.isActive ? 'rgba(144, 202, 249, 0.2)' : 'transparent'};
  
  &:hover {
    background-color: rgba(255, 255, 255, 0.1);
  }

  svg {
    margin-right: 8px;
    min-width: 16px; /* 防止图标大小变化导致文字跳动 */
    color: #88a1b9;
  }
`;

const NodeName = styled.span`
  white-space: nowrap;
`;


export default TreeNode;