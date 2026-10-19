// An agent's LLM reply, rendered as markdown (bold, lists, tables …). Raw HTML in it is not rendered.
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function Markdown({ text }) {
  return <div className="live-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown></div>;
}
