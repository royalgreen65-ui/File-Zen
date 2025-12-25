
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { FileMetadata, FolderMetadata, FileCategory, ProcessingState, DuplicateGroup, UndoRecord, CustomRule } from './types';
import { categorizeFiles } from './geminiService';
import { FileIcon } from './components/FileIcon';
import { VoiceChat } from './components/VoiceChat';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

type UtilityView = 'DASHBOARD' | 'ORGANIZER' | 'DUPLICATES' | 'RULES' | 'SAFETY' | 'LOGS';

interface SystemLogEntry {
  id: string;
  timestamp: Date;
  type: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  message: string;
}

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

const App: React.FC = () => {
  const [activeView, setActiveView] = useState<UtilityView>('DASHBOARD');
  const [sourceHandle, setSourceHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set<string>());
  const [systemLogs, setSystemLogs] = useState<SystemLogEntry[]>([]);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  
  const [processing, setProcessing] = useState<ProcessingState>({
    isScanning: false,
    isOrganizing: false,
    error: null,
    progress: 0,
  });

  const log = (type: SystemLogEntry['type'], message: string) => {
    setSystemLogs(prev => [{
      id: crypto.randomUUID(),
      timestamp: new Date(),
      type,
      message
    }, ...prev].slice(0, 100));
  };

  useEffect(() => {
    log('INFO', 'FileZen Utility initialized.');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme = prefersDark ? 'dark' : 'light';
    setTheme(initialTheme);
    document.documentElement.setAttribute('data-theme', initialTheme);
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
  };

  const handlePickFolder = async () => {
    try {
      setProcessing(prev => ({ ...prev, isScanning: true, error: null }));
      // @ts-ignore
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      setSourceHandle(handle);
      log('INFO', `Authorized access to: ${handle.name}`);
      await performScan(handle);
      setActiveView('ORGANIZER');
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        log('ERROR', 'Access denied.');
        setProcessing(prev => ({ ...prev, error: "Access Denied.", isScanning: false }));
      } else {
        setProcessing(prev => ({ ...prev, isScanning: false }));
      }
    }
  };

  const performScan = async (rootHandle: FileSystemDirectoryHandle) => {
    const foundFiles: FileMetadata[] = [];
    const excluded = new Set(['node_modules', '.git', 'tmp', '.DS_Store', 'AppData']);

    const scan = async (handle: FileSystemDirectoryHandle, currentPath = '') => {
      // @ts-ignore
      for await (const entry of handle.values()) {
        if (excluded.has(entry.name)) continue;
        if (entry.kind === 'file') {
          const file = await (entry as FileSystemFileHandle).getFile();
          foundFiles.push({
            name: entry.name,
            kind: 'file',
            size: file.size,
            lastModified: file.lastModified,
            extension: entry.name.split('.').pop()?.toLowerCase() || '',
            suggestedCategory: FileCategory.UNKNOWN,
            handle: entry,
            path: currentPath ? `${currentPath}/${entry.name}` : entry.name
          });
        } else if (entry.kind === 'directory') {
          await scan(entry as FileSystemDirectoryHandle, currentPath ? `${currentPath}/${entry.name}` : entry.name);
        }
      }
    };

    try {
      await scan(rootHandle);
      if (foundFiles.length > 0) {
        log('INFO', `Classifying ${foundFiles.length} files with Gemini...`);
        const aiCategories = await categorizeFiles(foundFiles.map(f => f.name));
        foundFiles.forEach(f => {
          if (aiCategories[f.name]) f.suggestedCategory = aiCategories[f.name];
        });
      }
      setFiles(foundFiles);
      setSelectedFiles(new Set(foundFiles.filter(f => f.suggestedCategory !== FileCategory.UNKNOWN).map(f => f.name)));
      log('SUCCESS', `Scan complete.`);
      setProcessing(prev => ({ ...prev, isScanning: false }));
    } catch (e) {
      log('ERROR', 'Scan failed.');
      setProcessing(prev => ({ ...prev, isScanning: false }));
    }
  };

  const stats = useMemo(() => {
    const counts: Record<string, number> = {};
    files.forEach(f => { counts[f.suggestedCategory] = (counts[f.suggestedCategory] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [files]);

  const COLORS = theme === 'dark' 
    ? ['#60cdff', '#6ccb5f', '#b191ff', '#ff9d5e', '#5fe7d1', '#5dc9e6', '#ffd04d']
    : ['#0078d4', '#107c10', '#5c2d91', '#d83b01', '#008272', '#00bcf2', '#ffb900'];

  const handleOrganize = async () => {
    if (!sourceHandle) return;
    setProcessing(prev => ({ ...prev, isOrganizing: true, progress: 0 }));
    let moved = 0;
    const targets = files.filter(f => selectedFiles.has(f.name) && f.suggestedCategory !== FileCategory.UNKNOWN);

    try {
      for (const file of targets) {
        const dir = await sourceHandle.getDirectoryHandle(file.suggestedCategory, { create: true });
        const fileData = await (file.handle as FileSystemFileHandle).getFile();
        const newFile = await dir.getFileHandle(file.name, { create: true });
        // @ts-ignore
        const writable = await newFile.createWritable();
        await writable.write(fileData);
        await writable.close();
        
        const pathParts = file.path.split('/');
        pathParts.pop();
        let parent = sourceHandle;
        for (const part of pathParts) if (part) parent = await parent.getDirectoryHandle(part);
        await parent.removeEntry(file.name);
        
        moved++;
        setProcessing(prev => ({ ...prev, progress: Math.round((moved / targets.length) * 100) }));
      }
      log('SUCCESS', `Organized ${moved} files.`);
      await performScan(sourceHandle);
    } catch (e) {
      log('ERROR', 'Operation failed.');
    } finally {
      setProcessing(prev => ({ ...prev, isOrganizing: false }));
    }
  };

  return (
    <div className={`flex h-screen w-full overflow-hidden text-[var(--win-text)] transition-colors duration-300`}>
      {/* Sidebar */}
      <nav className="mica-sidebar w-64 flex flex-col p-5 z-20">
        <div className="flex items-center gap-3 mb-10 px-2">
          <div className="w-10 h-10 bg-[var(--win-accent)] rounded-xl flex items-center justify-center shadow-lg transition-transform hover:scale-110">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
          </div>
          <span className="font-bold text-2xl tracking-tight">FileZen</span>
        </div>

        <div className="space-y-1.5 flex-1">
          {[
            { id: 'DASHBOARD', label: 'Dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
            { id: 'ORGANIZER', label: 'Organizer', icon: 'M4 6h16M4 10h16M4 14h16M4 18h16' },
            { id: 'DUPLICATES', label: 'Duplicate Hunter', icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4' },
            { id: 'LOGS', label: 'System Logs', icon: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
          ].map(item => (
            <button
              key={item.id}
              onClick={() => setActiveView(item.id as UtilityView)}
              className={`w-full flex items-center gap-4 px-4 py-3 rounded-lg text-sm font-semibold transition-all group ${activeView === item.id ? 'bg-[var(--win-accent-soft)] text-[var(--win-accent)] nav-item-active shadow-sm' : 'text-[var(--win-text-secondary)] hover:bg-black/5 dark:hover:bg-white/5'}`}
            >
              <svg className={`w-5 h-5 transition-transform duration-200 group-hover:scale-110 ${activeView === item.id ? 'opacity-100' : 'opacity-60'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} /></svg>
              {item.label}
            </button>
          ))}
        </div>

        <div className="mt-auto pt-6 border-t border-[var(--win-border)] space-y-4">
          <button onClick={toggleTheme} className="w-full flex items-center gap-4 px-4 py-2.5 rounded-lg text-sm font-semibold text-[var(--win-text-secondary)] hover:bg-black/5 dark:hover:bg-white/5 transition-all">
            {theme === 'light' ? 'Night Mode' : 'Day Mode'}
          </button>
          <div className="flex items-center gap-3 px-2">
             <div className="w-8 h-8 rounded-full bg-[var(--win-accent)] text-white flex items-center justify-center text-[10px] font-bold">OS</div>
             <div className="flex-1 min-w-0">
               <p className="text-xs font-bold truncate">Windows 11 Native</p>
               <p className="text-[10px] text-[var(--win-text-secondary)]">Pro Utility v6.0</p>
             </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden flex flex-col animate-win-fade">
        <header className="h-16 flex items-center justify-between px-10 bg-[var(--win-card)] border-b border-[var(--win-border)]">
           <div className="flex items-center gap-4">
             <h2 className="font-black text-[10px] uppercase tracking-[0.25em] text-[var(--win-text-secondary)] opacity-50">Local System</h2>
             <span className="text-[var(--win-border)]">|</span>
             <span className="font-bold text-sm tracking-tight">{activeView}</span>
           </div>
           {sourceHandle && (
             <div className="flex items-center gap-4">
                <button onClick={handlePickFolder} className="bg-[var(--win-accent-soft)] text-[var(--win-accent)] px-4 py-1.5 rounded-full text-xs font-bold hover:brightness-95 transition-all">
                  Connected: {sourceHandle.name}
                </button>
             </div>
           )}
        </header>

        <div className="flex-1 p-10 overflow-y-auto custom-scrollbar">
          {activeView === 'DASHBOARD' && (
            <div className="max-w-6xl mx-auto space-y-10">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="win-card p-10 lg:col-span-2">
                  <h4 className="font-bold text-lg mb-8">Storage Insights</h4>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={stats} cx="50%" cy="50%" innerRadius={80} outerRadius={110} paddingAngle={6} dataKey="value" stroke="none">
                          {stats.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="win-card p-8 border-l-4 border-l-[var(--win-accent)]">
                    <p className="text-[10px] font-black text-[var(--win-text-secondary)] uppercase tracking-widest mb-2">Workspace Health</p>
                    <p className="text-4xl font-bold tracking-tighter">{files.length > 0 ? 'Optimal' : 'Standby'}</p>
                    <p className="text-xs text-[var(--win-text-secondary)] mt-2">Local disk scanning active</p>
                  </div>

                  <div className="win-card p-8 bg-[var(--win-accent)] text-white shadow-xl shadow-[var(--win-accent-soft)]">
                    <p className="text-[10px] font-black text-white/50 uppercase tracking-widest mb-2">Native Utility Tip</p>
                    <p className="text-sm font-semibold leading-relaxed">Run the PowerShell script to create an EXE-style shortcut on your Desktop.</p>
                  </div>
                </div>
              </div>

              {/* Native Setup Section */}
              <div className="win-card p-10 flex flex-col md:flex-row items-center gap-10 bg-gradient-to-br from-[var(--win-accent-soft)] to-transparent border-none">
                 <div className="w-20 h-20 bg-white dark:bg-slate-800 rounded-3xl shadow-xl flex items-center justify-center shrink-0">
                    <svg className="w-10 h-10 text-[var(--win-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                 </div>
                 <div className="flex-1 text-center md:text-left">
                   <h3 className="text-xl font-bold mb-2">Enable Native Windows Shortcut</h3>
                   <p className="text-sm text-[var(--win-text-secondary)] leading-relaxed max-w-xl">
                     Get the full Desktop utility experience. Create a shortcut that launches FileZen in its own borderless window, pinned to your taskbar like a standard .exe.
                   </p>
                 </div>
                 <div className="shrink-0 space-y-3">
                   <button onClick={() => alert("Run the 'CreateShortcut.ps1' script in your project folder to create the shortcut.")} className="win-btn-primary w-full px-8 py-3 text-xs uppercase tracking-widest shadow-lg">Generate Shortcut</button>
                   <p className="text-[10px] text-center text-[var(--win-text-secondary)] italic">Requires Chrome or Edge</p>
                 </div>
              </div>

              {!sourceHandle && (
                <div className="win-card p-20 text-center border-dashed border-2">
                  <h3 className="text-2xl font-bold mb-4">No System Folder Connected</h3>
                  <p className="text-[var(--win-text-secondary)] mb-10 max-w-sm mx-auto text-sm">Select a directory like 'Downloads' or 'Desktop' to start AI organization.</p>
                  <button onClick={handlePickFolder} className="win-btn-primary px-12 py-4 text-sm shadow-2xl">Connect Workspace</button>
                </div>
              )}
            </div>
          )}

          {activeView === 'ORGANIZER' && sourceHandle && (
            <div className="max-w-6xl mx-auto flex flex-col h-full space-y-8 animate-win-fade">
              <div className="flex justify-between items-end">
                <div>
                  <h3 className="text-2xl font-bold tracking-tight">AI Sorting Room</h3>
                  <p className="text-sm text-[var(--win-text-secondary)] mt-1">Review Gemini's suggested classification before moving files.</p>
                </div>
                <div className="flex gap-4">
                  <button onClick={handleOrganize} disabled={selectedFiles.size === 0 || processing.isOrganizing} className="win-btn-primary px-10 py-3 text-xs uppercase tracking-widest disabled:opacity-30">
                    {processing.isOrganizing ? 'Executing...' : `Tidy ${selectedFiles.size} Items`}
                  </button>
                </div>
              </div>

              <div className="win-card flex-1 overflow-hidden flex flex-col">
                <div className="px-8 py-5 border-b border-[var(--win-border)] bg-black/[0.02] dark:bg-white/[0.02] grid grid-cols-12 text-[10px] font-black uppercase text-[var(--win-text-secondary)] tracking-widest">
                   <div className="col-span-1"></div>
                   <div className="col-span-6">System Entry Name</div>
                   <div className="col-span-2">File Weight</div>
                   <div className="col-span-3 text-right">Destination Folder</div>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-1.5">
                  {files.map(file => (
                    <div key={file.path} className={`grid grid-cols-12 items-center px-5 py-4 rounded-xl transition-all group ${selectedFiles.has(file.name) ? 'bg-[var(--win-accent-soft)]' : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'}`}>
                      <div className="col-span-1 flex justify-center">
                        <input type="checkbox" checked={selectedFiles.has(file.name)} onChange={() => {
                          const next = new Set(selectedFiles);
                          next.has(file.name) ? next.delete(file.name) : next.add(file.name);
                          setSelectedFiles(next);
                        }} className="w-5 h-5 rounded-md border-[var(--win-border)] accent-[var(--win-accent)]" />
                      </div>
                      <div className="col-span-6 flex items-center gap-5 min-w-0">
                         <FileIcon category={file.suggestedCategory} className="w-6 h-6 shrink-0" />
                         <span className="text-sm font-bold truncate text-[var(--win-text)]">{file.name}</span>
                      </div>
                      <div className="col-span-2 text-[12px] text-[var(--win-text-secondary)] font-mono opacity-60">{formatFileSize(file.size)}</div>
                      <div className="col-span-3 text-right">
                         <span className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider ${file.suggestedCategory === FileCategory.UNKNOWN ? 'bg-black/10 text-[var(--win-text-secondary)]' : 'bg-[var(--win-accent)] text-white shadow-md'}`}>
                           {file.suggestedCategory}
                         </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeView === 'LOGS' && (
            <div className="max-w-5xl mx-auto animate-win-fade">
               <div className="win-card overflow-hidden flex flex-col bg-[#111] border-[#222] shadow-2xl">
                  <div className="p-5 border-b border-[#222] flex justify-between items-center bg-[#1a1a1a]">
                    <span className="text-[10px] font-black text-[#555] uppercase tracking-[0.3em]">Runtime Console</span>
                    <button onClick={() => setSystemLogs([])} className="text-[10px] font-bold text-[#444] hover:text-[#aaa]">Clear Console</button>
                  </div>
                  <div className="p-8 h-[600px] overflow-y-auto custom-scrollbar font-mono text-[12px] leading-relaxed space-y-2">
                    {systemLogs.map(log => (
                      <div key={log.id} className="flex gap-6 group border-l-2 border-transparent hover:border-[#333] pl-3">
                        <span className="text-[#333] shrink-0 font-bold">{log.timestamp.toLocaleTimeString()}</span>
                        <span className={`shrink-0 w-16 text-center font-black rounded px-2 py-0.5 text-[10px] ${log.type === 'ERROR' ? 'text-red-500' : log.type === 'SUCCESS' ? 'text-emerald-500' : 'text-blue-500'}`}>
                          {log.type}
                        </span>
                        <span className="text-[#888] group-hover:text-white transition-colors">{log.message}</span>
                      </div>
                    ))}
                  </div>
               </div>
            </div>
          )}
        </div>
      </main>

      {processing.isScanning && (
        <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-xl animate-win-fade">
           <div className="win-card p-12 max-w-md w-full shadow-2xl text-center border-t-8 border-t-[var(--win-accent)]">
             <div className="w-16 h-16 border-4 border-[var(--win-accent)] border-t-transparent rounded-full animate-spin mx-auto mb-8"></div>
             <p className="font-bold text-2xl text-[var(--win-text)] tracking-tighter">Synchronizing Disk</p>
             <p className="text-sm text-[var(--win-text-secondary)] mt-4 leading-relaxed">Retrieving file system markers and initializing Gemini Vision for classification.</p>
           </div>
        </div>
      )}

      <VoiceChat isOpen={false} setIsOpen={() => {}} />
    </div>
  );
};

export default App;
