import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, X, Send, Bot, User, Loader2 } from 'lucide-react';
import { useAuth } from '../AuthContext';

interface ChatMessage {
  id: number;
  text: string;
  sender: 'user' | 'bot';
}

export default function AIAssistant() {
  const { token } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  useEffect(() => {
    if (isOpen && messages.length === 0) {
      setMessages([
        { id: Date.now(), text: 'أهلاً يا مدير! أنا המساعد الذكي، شلون أكدر أساعدك اليوم؟ (إضافة، تعديل، استفسار أو حذف)', sender: 'bot' }
      ]);
    }
  }, [isOpen, messages.length]);

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input;
    setInput('');
    setMessages(prev => [...prev, { id: Date.now(), text: userMessage, sender: 'user' }]);
    setIsLoading(true);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const res = await fetch('/api/chat-assistant', {
        method: 'POST',
        headers,
        body: JSON.stringify({ message: userMessage })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to get response');

      setMessages(prev => [...prev, { id: Date.now(), text: data.reply, sender: 'bot' }]);
    } catch (err: any) {
      let errorMsg = 'صار خطأ بالاتصال بالسيرفر.';
      if (err.message) {
         if (err.message.includes('503') || err.message.includes('high demand') || err.message.includes('UNAVAILABLE')) {
            errorMsg = 'سيرفرات الذكاء الاصطناعي عليها ضغط حالياً. يرجى المحاولة لاحقاً.';
         } else if (err.message.includes('429') || err.message.includes('Quota exceeded')) {
            errorMsg = 'تم تجاوز الحد المسموح للطلبات. يرجى الانتظار قليلاً.';
         } else if (err.message.includes('API key') || err.message.includes('API_KEY')) {
            errorMsg = 'مفتاح الذكاء الاصطناعي غير صالح.';
         } else {
            errorMsg = 'صار خطأ بالمعالجة.';
         }
      }
      setMessages(prev => [...prev, { id: Date.now(), text: '❌ عذراً: ' + errorMsg, sender: 'bot' }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 left-6 p-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full shadow-xl hover:shadow-2xl transition-all z-40 focus:outline-none"
        title="المساعد الذكي"
      >
        <Bot size={28} />
      </button>

      {isOpen && (
          <div
            className="fixed bottom-24 left-6 w-[350px] sm:w-[400px] max-h-[600px] h-[80vh] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col z-50 overflow-hidden"
          >
            {/* Header */}
            <div className="bg-slate-800 p-4 shrink-0 flex items-center justify-between border-b border-slate-700">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-lg">
                  <Bot size={20} />
                </div>
                <div>
                  <h3 className="font-semibold text-white">المساعد الذكي اللودكسي</h3>
                  <p className="text-xs text-slate-400">متصل وجاهز للمساعدة</p>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="text-slate-400 hover:text-white transition-colors p-1"
              >
                <X size={20} />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.sender === 'user' ? 'justify-start' : 'justify-end'}`}
                >
                  <div
                    className={`max-w-[85%] p-3 rounded-2xl text-sm ${
                      msg.sender === 'user'
                        ? 'bg-indigo-600 text-white rounded-tr-sm'
                        : 'bg-slate-800 text-slate-200 border border-slate-700 rounded-tl-sm'
                    } whitespace-pre-wrap`}
                    style={{ direction: 'rtl' }}
                  >
                    <div className="flex gap-2 items-center mb-1 opacity-70 border-b border-white/10 pb-1">
                      {msg.sender === 'user' ? <User size={12} /> : <Bot size={12} />}
                      <span className="text-[10px] uppercase font-medium">
                        {msg.sender === 'user' ? 'أنت' : 'المساعد'}
                      </span>
                    </div>
                    {msg.text}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-end">
                  <div className="bg-slate-800 border border-slate-700 rounded-2xl rounded-tl-sm p-3 text-slate-400 flex items-center gap-2 text-sm">
                    <Loader2 size={16} className="animate-spin" />
                    <span>جاري التفكير...</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Form */}
            <form onSubmit={handleSend} className="p-3 bg-slate-800 border-t border-slate-700 shrink-0">
              <div className="flex gap-2 bg-slate-900 border border-slate-600 rounded-xl p-1 relative">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="أضف بيعة، مصروف، أو استفسر عن شي..."
                  className="flex-1 bg-transparent border-none focus:outline-none text-white px-3 py-2 text-sm font-medium"
                  dir="rtl"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || isLoading}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-700 disabled:text-slate-500 text-white p-2 rounded-lg transition-colors flex items-center justify-center min-w-[40px]"
                >
                  <Send size={18} className="mr-1" />
                </button>
              </div>
            </form>
          </div>
        )}
    </>
  );
}
