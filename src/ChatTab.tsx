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
      content: `I'm Markr, your bookmark organization engine. 
      Just tell me what you want to clean up whether it's moving bookmarks, filtering by topic, or organizing open tabs and I'll show you a preview before making any changes.`,
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
        const { appliedCount, skippedCount, folderOpsCount = 0 } = message.payload;

        const parts: string[] = [];
        if (appliedCount > 0) {
          parts.push(`moved ${appliedCount} bookmark${appliedCount !== 1 ? 's' : ''}`);
        }
        if (folderOpsCount > 0) {
          parts.push(`updated ${folderOpsCount} folder${folderOpsCount !== 1 ? 's' : ''}`);
        }

        const summary =
          parts.length > 0
            ? `✅ Changes applied! I ${parts.join(' and ')}${
                skippedCount > 0 ? ` (${skippedCount} couldn't be completed)` : ''
              }.`
            : skippedCount > 0
              ? `⚠️ Nothing was changed — ${skippedCount} item${skippedCount !== 1 ? 's' : ''} couldn't be completed. Please try rephrasing your request.`
              : `✅ All done — there was nothing to change.`;

        const successMsg: ChatMessage = {
          role: 'assistant',
          content: summary,
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

  const handleSubmit = async (e: React.FormEvent) => {
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

    try {
      // Fetch bookmark tree and build path mappings
      const tree = await chrome.bookmarks.getTree();
      let folderTree = '';
      const pathToIdMap: Record<string, string> = {};

      try {
        folderTree = JSON.stringify(tree, null, 2);
        // Build path map from tree structure
        const buildPathMap = (nodes: chrome.bookmarks.BookmarkTreeNode[], path = '') => {
          for (const node of nodes) {
            const nodePath = path ? `${path}/${node.title}` : node.title;
            if (!node.url) { // folder
              pathToIdMap[nodePath] = node.id;
            }
            if (node.children) {
              buildPathMap(node.children, nodePath);
            }
          }
        };
        buildPathMap(tree);
      } catch {
        // Ignore tree serialization errors
      }

      const payload: ChatRequestPayload = {
        message: userMsg.content,
        serviceId: getSelectedServiceId(),
        modelId: getSelectedModelId(),
        maxOutputTokens: getSelectedMaxOutputTokens(),
        folderTree,
        pathToIdMap,
      };

      chrome.runtime.sendMessage({ type: 'CHAT_REQUEST', payload }).catch((error) => {
        console.error('[ChatTab] Failed to send message:', error);
        setIsLoading(false);
        const errorMsg: ChatMessage = {
          role: 'assistant',
          content: '❌ Error: Failed to send request to background worker.',
          timestamp: Date.now(),
          status: 'error',
          modelIndicator: activeModel || undefined,
        };
        setMessages((prev) => [...prev, errorMsg]);
      });
    } catch (error) {
      console.error('[ChatTab] Error preparing message:', error);
      setIsLoading(false);
      const errorMsg: ChatMessage = {
        role: 'assistant',
        content: '❌ Error: Failed to prepare message.',
        timestamp: Date.now(),
        status: 'error',
        modelIndicator: activeModel || undefined,
      };
      setMessages((prev) => [...prev, errorMsg]);
    }
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
              <div className="animate-pulse">
                <SparklesIcon width={12} height={12} />
              </div>
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
          <div className="chat-input-icon">
            <MessageSquareIcon width={16} height={16} />
          </div>
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
