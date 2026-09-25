// ContextMenu.tsx
import React from 'react';
import styled from 'styled-components';
import { type FileNodeData } from './TreeNode';

interface ContextMenuProps {
  x: number;
  y: number;
  node: FileNodeData | null; // null if right-clicking on the sidebar background
  onClose: () => void;
  onNewFile: (folderId?: string) => void;
  onNewFolder: (folderId?: string) => void;
  onRename: (node: FileNodeData) => void;
  onDelete: (node: FileNodeData) => void;
}

const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, node, onClose, onNewFile, onNewFolder, onRename, onDelete }) => {
  const isFolder = node?.type === 'folder';
  const isFile = node?.type === 'file';

  const handleAction = (action: (e: React.MouseEvent) => void) => (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent event from bubbling up
    action(e);
    onClose();
  };

  return (
    <MenuWrapper style={{ top: y, left: x }}>
      {/* Actions for Folders or Background */}
      {(isFolder || !node) && <MenuItem onClick={handleAction(() => onNewFile(node?.id))}>New File</MenuItem>}
      {(isFolder || !node) && <MenuItem onClick={handleAction(() => onNewFolder(node?.id))}>New Folder</MenuItem>}
      
      {/* Separator */}
      {(isFolder || !node) && (isFile || isFolder) && <MenuSeparator />}

      {/* Actions for any Node (File or Folder) */}
      {(isFile || isFolder) && <MenuItem onClick={handleAction(() => onRename(node!))}>Rename</MenuItem>}
      {(isFile || isFolder) && <MenuItem onClick={handleAction(() => onDelete(node!))} $isDestructive>Delete</MenuItem>}
    </MenuWrapper>
  );
};

const MenuWrapper = styled.div`
  position: fixed;
  z-index: 1000;
  background-color: #2c2c2c;
  border: 1px solid #444;
  border-radius: 4px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
  min-width: 150px;
  padding: 5px 0;
`;

// 同 TreeNode：传给 styled.div 的非 HTML 属性必须加 `$`，否则会透传到 DOM。
const MenuItem = styled.div<{ $isDestructive?: boolean }>`
  padding: 8px 16px;
  font-size: 14px;
  color: ${props => props.$isDestructive ? '#f44336' : '#cccccc'};
  cursor: pointer;

  &:hover {
    background-color: #3e3e3e;
    color: ${props => props.$isDestructive ? '#ff6f61' : '#ffffff'};
  }
`;

const MenuSeparator = styled.div`
  height: 1px;
  background-color: #444;
  margin: 4px 0;
`;

export default ContextMenu;