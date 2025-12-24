
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { FileMetadata, FileCategory, ProcessingState } from './types';
import { categorizeFiles } from './geminiService';
import { FileIcon } from './components/FileIcon';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

type AppStep = 'IDLE' | 'SCANNING' | 'REVIEW' | 'VERIFYING' | 'EXPORTING' | 'COMPLETED';

const App: React.FC = () => {
  const [step, setStep] = useState<AppStep>('IDLE');
  const [sourceHandle, setSourceHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [destHandle, setDestHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [rules, setRules] = useState<Record<string, FileCategory>>({});
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  
  const [processing, setProcessing] = useState<ProcessingState>({
    isScanning: false,
    isOrganizing: false,
    error: null,
    progress: 0
  });

  const handlePickSource = async () => {
    try {
      setProcessing(prev => ({ ...prev, isScanning: true, error: null }));
      setStep('SCANNING');
      // @ts-ignore
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      setSourceHandle(handle);
      await scanDirectory(handle);
    } catch (err: any) {
      setStep('IDLE');
      if (err.name !== 'AbortError') {
        setProcessing(prev => ({ ...prev, error: "Access denied. Please grant permissions to tidy files.", isScanning: false }));
      } else {
        setProcessing(prev => ({ ...prev, isScanning: false }));
      }
    }
  };

  const scanDirectory = async (handle: FileSystemDirectoryHandle) => {
    const foundFiles: FileMetadata[] = [];
    try {
      // @ts-ignore
      for await (const entry of handle.values()) {
        if (entry.kind === 'file') {
          const fileHandle = entry as FileSystemFileHandle;
          const file = await fileHandle.getFile();
          foundFiles.push({
            name: entry.name,
            kind: 'file',
            size: file.size,
            lastModified: file.lastModified,
            extension: entry.name.split('.').pop()?.toLowerCase() || '',
            suggestedCategory: FileCategory.UNKNOWN,
            handle: entry
          });
        }
      }

      setProcessing(prev => ({ ...prev, progress: 30 }));

      if (foundFiles.length > 0) {
        const fileNames = foundFiles.map(f => f.name);
        const categories = await categorizeFiles(fileNames);
        
        const updatedFiles = foundFiles.map(f => {
          // Priority: User Rule > AI Suggestion
          const rule = rules[f.extension];
          return {
            ...f,
            suggestedCategory: rule || categories[f.name] || FileCategory.UNKNOWN
          };
        });
        
        setFiles(updatedFiles);
        setSelectedFiles(new Set(updatedFiles.filter(f => f.suggestedCategory !== FileCategory.UNKNOWN).map(f => f.name)));
      }

      setStep('REVIEW');
      setProcessing(prev => ({ ...prev, isScanning: false, progress: 100 }));
    } catch (err) {
      setProcessing(prev => ({ ...prev, error: "Failed to read files.", isScanning: false }));
      setStep('IDLE');
    }
  };

  const updateFileCategory = (fileName: string, category: FileCategory) => {
    const file = files.find(f => f.name === fileName);
    if (!file) return;

    // Save as an automated sorting rule
    setRules(prev => ({ ...prev, [file.extension]: category }));

    // Apply to current session
    setFiles(prev => prev.map(f => 
      f.extension === file.extension ? { ...f, suggestedCategory: category } : f
    ));

    // Automatically select if now categorized
    if (category !== FileCategory.UNKNOWN) {
      setSelectedFiles(prev => {
        const next = new Set(prev);
        files.filter(f => f.extension === file.extension).forEach(f => next.add(f.name));
        return next;
      });
    }
  };

  const toggleFileSelection = (name: string) => {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const startCleanup = async () => {
    setStep('VERIFYING');
  };

  const executeExport = async () => {
    if (!sourceHandle) return;
    
    try {
      setProcessing(prev => ({ ...prev, isOrganizing: true, progress: 0 }));
      setStep('EXPORTING');

      // Request destination folder (simulating "Completed Download" on Desktop)
      // @ts-ignore
      const destination = await window.showDirectoryPicker({ 
        mode: 'readwrite',
        id: 'export_dest',
        startIn: 'desktop'
      });
      setDestHandle(destination);

      const toMove = files.filter(f => selectedFiles.has(f.name));
      let count = 0;

      for (const file of toMove) {
        const category = file.suggestedCategory;
        // Create sub-directory in destination
        const catDir = await destination.getDirectoryHandle(category, { create: true });
        
        const fileHandle = file.handle as FileSystemFileHandle;
        const fileData = await fileHandle.getFile();
        
        // Write to destination
        const newFileHandle = await catDir.getFileHandle(file.name, { create: true });
        // @ts-ignore
        const writable = await newFileHandle.createWritable();
        await writable.write(fileData);
        await writable.close();

        // Remove from source
        await sourceHandle.removeEntry(file.name);
        
        count++;
        setProcessing(prev => ({ ...prev, progress: Math.round((count / toMove.length) * 100) }));
      }

      setStep('COMPLETED');
      setProcessing(prev => ({ ...prev, isOrganizing: false }));
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setStep('REVIEW');
        setProcessing(prev => ({ ...prev, isOrganizing: false }));
      } else {
        setProcessing(prev => ({ ...prev, error: "Export failed: " + err.message, isOrganizing: false }));
      }
    }
  };

  const reset = () => {
    setStep('IDLE');
    setFiles([]);
    setSourceHandle(null);
    setDestHandle(null);
    setProcessing({ isScanning: false, isOrganizing: false, error: null, progress: 0 });
  };

  const statsData = useMemo(() => {
    const counts: Record<string, number> = {};
    files.filter(f => selectedFiles.has(f.name)).forEach(f => {
      counts[f.suggestedCategory] = (counts[f.suggestedCategory] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [files, selectedFiles]);

  const COLORS = ['#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#6366F1', '#EC4899', '#64748B'];

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      {/* Dynamic Header */}
      <header className="mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span className="bg-blue-600 text-white p-2 rounded-lg">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </span>
            <span className="text-blue-600 font-bold tracking-widest text-xs uppercase">Desktop Utility</span>
          </div>
          <h1 className="text-4xl font-extrabold text-slate-900">Download Tidy</h1>
          <p className="text-slate-500 mt-1">
            {step === 'IDLE' && "Clean up and organize your downloads folder instantly."}
            {step === 'SCANNING' && "Analyzing file structures and metadata..."}
            {step === 'REVIEW' && "Review categorization and apply sorting rules."}
            {step === 'VERIFYING' && "Confirm your changes before moving files."}
            {step === 'EXPORTING' && "Migrating files to your organized destination..."}
            {step === 'COMPLETED' && "Organization complete. Your downloads folder is now tidy!"}
          </p>
        </div>

        {step === 'IDLE' && (
          <button
            onClick={handlePickSource}
            className="bg-slate-900 hover:bg-slate-800 text-white px-8 py-4 rounded-xl font-bold flex items-center gap-3 transition-all shadow-xl shadow-slate-200"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9l-2-2H5a2 2 0 00-2 2v11z" />
            </svg>
            Scan Downloads Folder
          </button>
        )}

        {step === 'REVIEW' && (
          <div className="flex gap-3">
            <button onClick={reset} className="px-6 py-3 text-slate-500 hover:text-slate-700 font-semibold">Discard</button>
            <button
              onClick={startCleanup}
              disabled={selectedFiles.size === 0}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2 transition-all shadow-lg shadow-blue-100"
            >
              Next: Verify Move ({selectedFiles.size})
            </button>
          </div>
        )}
      </header>

      {/* Main UI States */}
      <main className="min-h-[500px]">
        {processing.error && (
          <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl mb-8 flex items-center gap-3">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {processing.error}
          </div>
        )}

        {step === 'IDLE' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 py-8">
            <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm">
              <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mb-6">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
              </div>
              <h3 className="text-xl font-bold mb-2">Automated Rules</h3>
              <p className="text-slate-500 text-sm">Download Tidy learns your habits. Categorize once, and it remembers forever.</p>
            </div>
            <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm">
              <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mb-6">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
              </div>
              <h3 className="text-xl font-bold mb-2">Safe Verification</h3>
              <p className="text-slate-500 text-sm">Every file is verified before being moved. Nothing is lost, only organized.</p>
            </div>
            <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm">
              <div className="w-12 h-12 bg-green-50 text-green-600 rounded-2xl flex items-center justify-center mb-6">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
              </div>
              <h3 className="text-xl font-bold mb-2">Local & Secure</h3>
              <p className="text-slate-500 text-sm">Powered by Gemini but runs in your browser. Your files never leave your computer.</p>
            </div>
          </div>
        )}

        {step === 'SCANNING' && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="relative w-24 h-24 mb-8">
              <div className="absolute inset-0 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
              <div className="absolute inset-2 border-4 border-slate-200 border-b-transparent rounded-full animate-spin [animation-direction:reverse]"></div>
            </div>
            <h2 className="text-2xl font-bold text-slate-900">Scanning your workstation...</h2>
            <div className="mt-4 w-64 bg-slate-100 h-2 rounded-full overflow-hidden">
               <div className="bg-blue-600 h-full transition-all" style={{ width: `${processing.progress}%` }}></div>
            </div>
          </div>
        )}

        {step === 'REVIEW' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-4">
              <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
                <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
                  <h3 className="font-bold text-slate-800 uppercase tracking-wider text-xs">File Queue</h3>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setSelectedFiles(new Set(files.map(f => f.name)))}
                      className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                    >
                      Select All
                    </button>
                    <span className="text-slate-300">|</span>
                    <button 
                      onClick={() => setSelectedFiles(new Set())}
                      className="text-xs font-semibold text-slate-500 hover:text-slate-700"
                    >
                      Deselect
                    </button>
                  </div>
                </div>
                <div className="max-h-[600px] overflow-y-auto custom-scrollbar divide-y divide-slate-50">
                  {files.map((file) => (
                    <div 
                      key={file.name} 
                      className={`px-6 py-4 flex items-center gap-4 transition-colors group ${selectedFiles.has(file.name) ? 'bg-blue-50/30' : 'hover:bg-slate-50'}`}
                    >
                      <input 
                        type="checkbox"
                        checked={selectedFiles.has(file.name)}
                        onChange={() => toggleFileSelection(file.name)}
                        className="w-5 h-5 rounded-md border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <FileIcon category={file.suggestedCategory} className="w-8 h-8 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-800 truncate" title={file.name}>{file.name}</p>
                        <p className="text-xs text-slate-400">Extension: <span className="uppercase text-slate-600 font-bold">{file.extension || 'none'}</span> • {(file.size / 1024 / 1024).toFixed(2)} MB</p>
                      </div>
                      <select
                        value={file.suggestedCategory}
                        onChange={(e) => updateFileCategory(file.name, e.target.value as FileCategory)}
                        className="bg-slate-100 border-none text-xs font-bold rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                      >
                        {Object.values(FileCategory).map(cat => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <aside className="space-y-6">
              <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm">
                <h3 className="font-bold text-slate-800 mb-6 text-sm uppercase tracking-wider">Classification Map</h3>
                <div className="h-48 relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={statsData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={70}
                        paddingAngle={4}
                        dataKey="value"
                      >
                        {statsData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-2xl font-black text-slate-800">{selectedFiles.size}</span>
                    <span className="text-[10px] text-slate-400 font-bold uppercase">Files</span>
                  </div>
                </div>
                <div className="mt-4 space-y-1">
                  {statsData.map((stat, idx) => (
                    <div key={stat.name} className="flex items-center justify-between text-xs py-1">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }}></div>
                        <span className="text-slate-500 font-medium">{stat.name}</span>
                      </div>
                      <span className="font-bold text-slate-700">{stat.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-slate-900 rounded-2xl p-6 text-white overflow-hidden relative">
                <div className="absolute top-0 right-0 p-4 opacity-10">
                  <svg className="w-16 h-16" fill="currentColor" viewBox="0 0 20 20"><path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1a1 1 0 112 0v1a1 1 0 11-2 0zM13.536 14.95a1 1 0 011.414 0l.707.707a1 1 0 01-1.414 1.414l-.707-.707a1 1 0 010-1.414zM15.657 15.657l.707.707a1 1 0 01-1.414 1.414l-.707-.707a1 1 0 011.414-1.414z" /></svg>
                </div>
                <h4 className="text-lg font-bold mb-2">Automated Rules</h4>
                <p className="text-slate-400 text-xs mb-4 leading-relaxed">Changes you make to categories apply to all similar extensions automatically.</p>
                <div className="space-y-2">
                  {Object.entries(rules).map(([ext, cat]) => (
                    <div key={ext} className="flex items-center justify-between text-[10px] bg-white/5 p-2 rounded-lg border border-white/10">
                      <span className="uppercase font-black text-blue-400">.{ext}</span>
                      <span className="text-white/60">→</span>
                      <span className="font-bold">{cat}</span>
                    </div>
                  ))}
                  {Object.keys(rules).length === 0 && <p className="text-slate-600 text-[10px] italic">No custom rules created yet.</p>}
                </div>
              </div>
            </aside>
          </div>
        )}

        {step === 'VERIFYING' && (
          <div className="max-w-3xl mx-auto bg-white border border-slate-100 rounded-3xl p-10 shadow-2xl">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
              </div>
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Final Verification</h2>
                <p className="text-slate-500">Review the organization plan below.</p>
              </div>
            </div>

            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-50 p-4 rounded-2xl">
                  <p className="text-xs text-slate-400 font-bold uppercase mb-1">Source Folder</p>
                  <p className="text-sm font-bold text-slate-700 truncate">{sourceHandle?.name || 'Downloads'}</p>
                </div>
                <div className="bg-slate-50 p-4 rounded-2xl border-2 border-blue-100">
                  <p className="text-xs text-blue-400 font-bold uppercase mb-1">Target Action</p>
                  <p className="text-sm font-bold text-slate-700">Move to "Completed Download" Subfolders</p>
                </div>
              </div>

              <div className="bg-amber-50 border border-amber-100 p-4 rounded-2xl flex gap-3">
                <svg className="w-5 h-5 text-amber-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                <p className="text-xs text-amber-700 leading-relaxed">
                  <strong>Verification Warning:</strong> You are about to move {selectedFiles.size} files. This will create new folders in your destination to separate documents, images, and other media.
                </p>
              </div>

              <div className="flex items-center gap-4 pt-4">
                <button 
                  onClick={() => setStep('REVIEW')}
                  className="flex-1 px-8 py-4 rounded-xl font-bold text-slate-500 hover:bg-slate-100 transition-all"
                >
                  Go Back & Edit
                </button>
                <button 
                  onClick={executeExport}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-xl font-bold shadow-xl shadow-blue-100 transition-all flex items-center justify-center gap-2"
                >
                  Confirm & Export
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 'EXPORTING' && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-full max-w-md bg-white p-10 rounded-3xl border border-slate-100 shadow-xl">
              <h2 className="text-2xl font-bold mb-2">Exporting Files...</h2>
              <p className="text-slate-500 text-sm mb-8">Please keep this window open while we move your files.</p>
              
              <div className="relative h-4 bg-slate-100 rounded-full overflow-hidden mb-4">
                <div 
                  className="absolute inset-y-0 left-0 bg-blue-600 transition-all duration-300 ease-out"
                  style={{ width: `${processing.progress}%` }}
                ></div>
              </div>
              
              <div className="flex justify-between text-xs font-bold uppercase">
                <span className="text-blue-600">{processing.progress}% Finished</span>
                <span className="text-slate-400">{selectedFiles.size} Items Total</span>
              </div>
            </div>
          </div>
        )}

        {step === 'COMPLETED' && (
          <div className="max-w-2xl mx-auto text-center py-12">
            <div className="w-24 h-24 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-8 shadow-inner">
              <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
            </div>
            <h2 className="text-4xl font-black text-slate-900 mb-4">Done & Dusted!</h2>
            <p className="text-slate-500 text-lg mb-10 leading-relaxed">
              Successfully moved <span className="text-slate-900 font-bold">{selectedFiles.size} files</span> to organized folders. 
              Your original downloads directory is now clean.
            </p>
            <div className="bg-slate-100 p-6 rounded-3xl mb-10 flex items-start gap-4 text-left">
              <svg className="w-6 h-6 text-slate-400 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <div>
                <p className="text-sm font-bold text-slate-700">Next Step:</p>
                <p className="text-sm text-slate-500">You can now find your organized files in the <span className="font-bold">"Completed Download"</span> folder you selected on your desktop.</p>
              </div>
            </div>
            <button
              onClick={reset}
              className="bg-slate-900 hover:bg-slate-800 text-white px-10 py-4 rounded-2xl font-bold transition-all shadow-xl shadow-slate-200"
            >
              Start New Tidy Session
            </button>
          </div>
        )}
      </main>

      <footer className="mt-20 pt-8 border-t border-slate-100 flex flex-col md:flex-row justify-between items-center gap-4 text-slate-400 text-xs font-medium">
        <p>&copy; 2024 Download Tidy Engine • Ver 2.0 Desktop Preview</p>
        <div className="flex gap-6">
          <span className="flex items-center gap-2"><div className="w-2 h-2 bg-green-500 rounded-full"></div> Fully Local Processing</span>
          <span className="flex items-center gap-2"><div className="w-2 h-2 bg-blue-500 rounded-full"></div> PWA Supported</span>
        </div>
      </footer>
    </div>
  );
};

export default App;
