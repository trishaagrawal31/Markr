import { useState, useRef, useEffect } from 'react';
import { SendIcon, SparklesIcon, MessageSquareIcon } from './components/icons/Icons';
import Button from './components/Button/Button';
import ActionPreview from './components/ActionPreview/ActionPreview';
import { getSelectedServiceId, getSelectedModelId, getSelectedMaxOutputTokens } from './services/selectedState';
import { type ChatRequestPayload } from './types/messaging';
import { type ChatMessage, type ActionPreviewData, type ModelIndicator } from './types/chat';
import './ChatTab.css';

const ChatTab = () => {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isApplyingAction, setIsApplyingAction] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: `I'm Markr AI, your bookmark organization engine. I can handle five powerful operations:

1. **Move Bookmarks** - Organize bookmarks into folders (existing or new)
2. **Create Folders** - Set up new folder structures as needed
3. **Unpack Folders** - Move folder contents to parent and delete the empty folder
4. **Delete Folders** - Remove folders and their contents
5. **Smart Filtering** - Handle specific sub-selections by criteria (React, design, tools, etc.)

💡 **Pro Tip:** I can also organize your **open tabs** directly! Just ask:
- "Save these open tabs" → Bookmarks all tabs to a folder
- "Organize my tabs into Projects" → Categorizes tabs intelligently
- "Save and organize coding tabs" → Saves matching tabs to your setup

Just describe what you want, and I'll generate a precise preview for your approval before making changes.`,
      timestamp: Date.now(),
      status: 'complete',
    },
  ]);
  const [pendingAction, setPendingAction] = useState<ActionPreviewData | null>(null);
  const [activeModel, setActiveModel] = useState<ModelIndicator | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, pendingAction]);

  useEffect(() => {
    const listener = (message: any) => {
      if (message.type === 'CHAT_RESPONSE') {
        const { message: assistantMsg, actionPreview, modelUsed } = message.payload;

        setActiveModel(modelUsed);

        const newMessage: ChatMessage = {
          role: 'assistant',
          content: assistantMsg,
          timestamp: Date.now(),
          status: 'complete',
          actionPreview,
          modelIndicator: modelUsed,
        };

        setMessages((prev) => [...prev, newMessage]);
        setIsLoading(false);

        if (actionPreview) {
          setPendingAction(actionPreview);
        }
      } else if (message.type === 'CHAT_ACTION_COMPLETE') {
        const { appliedCount, skippedCount } = message.payload;
        const successMsg: ChatMessage = {
          role: 'assistant',
          content: `✅ Changes applied! Moved ${appliedCount} bookmark${appliedCount !== 1 ? 's' : ''}${
            skippedCount > 0 ? ` (${skippedCount} couldn't be moved)` : ''
          }.`,
          timestamp: Date.now(),
          status: 'complete',
          modelIndicator: activeModel || undefined,
        };
        setMessages((prev) => [...prev, successMsg]);
        setPendingAction(null);
        setIsApplyingAction(false);
      } else if (message.type === 'CHAT_ACTION_ERROR') {
        const { errorMessage } = message.payload;
        const errorMsg: ChatMessage = {
          role: 'assistant',
          content: `❌ Error: ${errorMessage}`,
          timestamp: Date.now(),
          status: 'error',
          modelIndicator: activeModel || undefined,
        };
        setMessages((prev) => [...prev, errorMsg]);
        setPendingAction(null);
        setIsApplyingAction(false);
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [activeModel]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMsg: ChatMessage = {
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
      status: 'complete',
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    const payload: ChatRequestPayload = {
      message: userMsg.content,
      serviceId: getSelectedServiceId(),
      modelId: getSelectedModelId(),
      maxOutputTokens: getSelectedMaxOutputTokens(),
      folderTree: '',
      pathToIdMap: {},
    };

    chrome.runtime.sendMessage({ type: 'CHAT_REQUEST', payload });
  };

  const handleApproveAction = () => {
    if (!pendingAction) return;

    setIsApplyingAction(true);
    chrome.runtime.sendMessage({
      type: 'APPLY_CHAT_ACTION',
      payload: { actionPreview: pendingAction },
    });
  };

  const handleCancelAction = () => {
    setPendingAction(null);
    const cancelMsg: ChatMessage = {
      role: 'assistant',
      content: "Changes cancelled. Let me know if you'd like to try something different!",
      timestamp: Date.now(),
      status: 'complete',
      modelIndicator: activeModel || undefined,
    };
    setMessages((prev) => [...prev, cancelMsg]);
  };

  return (
    <div className="chat-tab-container">
      {activeModel && (
        <div className="chat-model-indicator">
          <span className="model-badge">⚡ {activeModel.provider}: {activeModel.model}</span>
        </div>
      )}

      <div className="chat-messages" ref={scrollRef}>
        {messages.map((msg, i) => (
          <div key={i}>
            <div className={`chat-bubble-wrapper ${msg.role}`}>
              <div className="chat-avatar">
                {msg.role === 'assistant' ? (
                  <SparklesIcon width={12} height={12} />
                ) : (
                  <div className="user-avatar" />
                )}
              </div>
              <div className={`chat-bubble ${msg.role} ${msg.status}`}>
                {msg.content}
              </div>
            </div>
            {msg.actionPreview && !pendingAction && (
              <div className="chat-action-preview-wrapper">
                <ActionPreview
                  actionPreview={msg.actionPreview}
                  onApprove={handleApproveAction}
                  onCancel={handleCancelAction}
                  isLoading={isApplyingAction}
                />
              </div>
            )}
          </div>
        ))}
        {isLoading && (
          <div className="chat-bubble-wrapper assistant">
            <div className="chat-avatar">
              <SparklesIcon width={12} height={12} className="animate-pulse" />
            </div>
            <div className="chat-bubble assistant typing">
              <span className="thinking-dots">Thinking</span>
              <span className="thinking-dots-anim">.</span>
              <span className="thinking-dots-anim">.</span>
              <span className="thinking-dots-anim">.</span>
            </div>
          </div>
        )}
        {pendingAction && (
          <div className="chat-action-preview-wrapper">
            <ActionPreview
              actionPreview={pendingAction}
              onApprove={handleApproveAction}
              onCancel={handleCancelAction}
              isLoading={isApplyingAction}
            />
          </div>
        )}
      </div>

      <form className="chat-input-wrapper" onSubmit={handleSubmit}>
        <div className="chat-input-container">
          <MessageSquareIcon className="chat-input-icon" width={16} height={16} />
          <input
            type="text"
            placeholder="Type a command (e.g., 'Organize open tabs')..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isLoading || isApplyingAction}
          />
          <Button
            variant="primary"
            compact
            disabled={!input.trim() || isLoading || isApplyingAction}
          >
            <SendIcon width={14} height={14} />
          </Button>
        </div>
      </form>
    </div>
  );
};

export default ChatTab;