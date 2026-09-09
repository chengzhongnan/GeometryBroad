import React, { useState, useEffect } from 'react';
import styled, { keyframes } from 'styled-components';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// 1. 定义新的存储 Key
const API_KEY_STORAGE_KEY = 'ai-api-key';
const API_URL_STORAGE_KEY = 'ai-api-url';
const MODEL_NAME_STORAGE_KEY = 'ai-model-name'; 

export const getChatAISetting = (): {apiKey: string | null, apiUrl: string | null, model: string | null} => {
    const savedApiKey = localStorage.getItem(API_KEY_STORAGE_KEY);
    const savedApiUrl = localStorage.getItem(API_URL_STORAGE_KEY);
    const savedModelName = localStorage.getItem(MODEL_NAME_STORAGE_KEY); 

    return {
        apiKey: savedApiKey,
        apiUrl: savedApiUrl,
        model: savedModelName
    }
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const [apiKey, setApiKey] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [modelName, setModelName] = useState(''); 

  useEffect(() => {
    // 组件加载时，从 localStorage 读取所有已保存的设置
    const apiSetting = getChatAISetting();
    
    if (apiSetting.apiKey) setApiKey(apiSetting.apiKey);
    if (apiSetting.apiUrl) setApiUrl(apiSetting.apiUrl);
    if (apiSetting.model) setModelName(apiSetting.model); 
  }, []);
  
  if (!isOpen) return null;

  const handleSave = () => {
    // 保存所有设置到 localStorage
    localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
    localStorage.setItem(API_URL_STORAGE_KEY, apiUrl);
    localStorage.setItem(MODEL_NAME_STORAGE_KEY, modelName); 
    
    alert('Settings Saved!');
    onClose();
  };

  return (
    <ModalOverlay onClick={onClose}>
      <ModalContent onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <ModalHeader>AI Settings</ModalHeader>
        <FormGroup>
          <Label htmlFor="apiUrl">API Endpoint</Label>
          <Input 
            id="apiUrl"
            type="text" 
            value={apiUrl} 
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setApiUrl(e.target.value)} 
            placeholder="https://api.openai.com/v1"
          />
        </FormGroup>

        <FormGroup>
          <Label htmlFor="apiKey">API Key</Label>
          <Input 
            id="apiKey"
            type="password" 
            value={apiKey} 
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setApiKey(e.target.value)} 
            placeholder="sk-..."
          />
        </FormGroup>
        
        <FormGroup>
          <Label htmlFor="modelName">Model Name</Label>
          <Input 
            id="modelName"
            type="text" 
            value={modelName} 
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setModelName(e.target.value)} 
            placeholder="gpt-4, gpt-3.5-turbo, etc."
          />
        </FormGroup>

        <Button onClick={handleSave}>Save Settings</Button>
      </ModalContent>
    </ModalOverlay>
  );
};

const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

const slideUp = keyframes`
  from { transform: translateY(30px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
`;

const ModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.6);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
  animation: ${fadeIn} 0.3s ease-out;
`;

const ModalContent = styled.div`
  background-color: #ffffff;
  padding: 2.5rem;
  border-radius: 16px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
  width: 100%;
  max-width: 500px;
  box-sizing: border-box;
  animation: ${slideUp} 0.4s ease-out;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
`;

const ModalHeader = styled.h2`
  margin: 0;
  font-size: 1.75rem;
  font-weight: 600;
  color: #1f2937;
  text-align: center;
`;

const FormGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
`;

const Label = styled.label`
  font-size: 0.9rem;
  font-weight: 500;
  color: #4b5563;
`;

const Input = styled.input`
  width: 100%;
  padding: 0.8rem 1rem;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 1rem;
  box-sizing: border-box;
  transition: border-color 0.2s, box-shadow 0.2s;

  &:focus {
    outline: none;
    border-color: #4f46e5;
    box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.15);
  }
`;

const Button = styled.button`
  width: 100%;
  padding: 0.85rem 1rem;
  margin-top: 1rem;
  border: none;
  border-radius: 8px;
  background-color: #4f46e5;
  color: #ffffff;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.2s ease;

  &:hover {
    background-color: #4338ca;
  }
`;
