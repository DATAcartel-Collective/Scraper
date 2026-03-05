import React, { useState, useEffect, useRef } from "react";

// --- CSS STYLES ---
const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=JetBrains+Mono:wght@300;400;500;700&family=Space+Grotesk:wght@300;400;500;600&display=swap');

  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #080810; color: #f1f5f9; font-family: 'Space Grotesk', sans-serif; }
  
  ::-webkit-scrollbar { width: 5px; height: 5px; }
  ::-webkit-scrollbar-track { background: #0d0d1a; }
  ::-webkit-scrollbar-thumb { background: #2a2a3e; border-radius: 4px; }
  
  @keyframes fadeUp { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: translateY(0) } }
  @keyframes shimmer { 0% { background-position: -200% 0 } 100% { background-position: 200% 0 } }
  @keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.4 } }

  .fade-up { animation: fadeUp .45s ease both; }
  .shimmer-btn {
    background: linear-gradient(90deg, #f59e0b 0%, #fbbf24 40%, #f59e0b 60%, #d97706 100%);
    background-size: 200% 100%;
    animation: shimmer 2.5s linear infinite;
  }
  .tab-active {
    background: linear-gradient(135deg, rgba(245,158,11,0.1), transparent);
    border-bottom: 2px solid #f59e0b !important;
    color: #f59e0b !important;
  }
  .log-line { font-family: 'JetBrains Mono', monospace; font-size: 11px; margin-bottom: 4px; }
  .log-info { color: #34d399; }
  .log-debug { color: #60a5fa; }
  .log-warn { color: #f59e0b; }
  .log-error { color: #ef4444; }

  .toggle-checkbox:checked + .toggle-label { background-color: #f59e0b; }
  .toggle-checkbox:checked + .toggle-label:after { transform: translateX(100%); }
  .toggle-label {
    width: 36px; height: 20px; background-color: #1c1c2e; border-radius: 9999px;
    position: relative; cursor: pointer; display: inline-block; transition: background-color .2s;
  }
  .toggle-label:after {
    content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
    background-color: white; border-radius: 50%; transition: transform .2s;
  }
`;

// --- MOCK DATA ---
const ITEMS = Array.from({length: 45}, (_, i) => ({
    id: i, line: `00${i+1}0`, code: `20100${i}00`, desc: `Roadway Improvement Item ${i+1}`, 
    unit: "SYS", qty: 1000 + (i*10), eng: 15.00, bids:[14.0, 16.5, 13.8], cat: "Earthwork"
}));

const fmt$ = (n) => "$" + Number(n).toLocaleString("en-US", {minimumFractionDigits: 2});

// --- COMPONENTS ---
function Toggle({ checked, onChange, label, desc }) {
  return (
    <div style={{display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", background: "#0d0d1a", border: "1px solid #1c1c2e", borderRadius: 8, marginBottom: 10}}>
      <div>
        <div style={{fontFamily: "Rajdhani", fontWeight: 600, fontSize: 14, color: "#f1f5f9"}}>{label}</div>
        <div style={{fontSize: 11, color: "#64748b"}}>{desc}</div>
      </div>
      <div>
        <input type="checkbox" id={label} className="toggle-checkbox" checked={checked} onChange={onChange} style={{display: "none"}} />
        <label htmlFor={label} className="toggle-label"></label>
      </div>
    </div>
  );
}

function ConfigureTab({ isRunning, setIsRunning }) {
  const [headless, setHeadless] = useState(false);
  const [deepScrape, setDeepScrape] = useState(false);
  const[logs, setLogs] = useState([]);
  const terminalRef = useRef(null);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  const handleRun = () => {
    setIsRunning(true);
    setLogs([`<span class="log-info">[INFO] Connecting to IDOT WCTB Direct URL...</span>`]);
    
    const sequence = [[500,  `<span class="log-debug">[DEBUG] Chrome launched ${headless ? 'in Background' : 'Visibly'}.</span>`],[1500, `<span class="log-info">[INFO] Waiting for table elements to load...</span>`],
      [3000, `<span class="log-info">[INFO] Page loaded successfully. Extracting Headers.</span>`],
      [4500, `<span class="log-debug">[DEBUG] Found 45 rows using selector 'table.bid-table tbody tr'.</span>`],[6000, `<span class="log-info">[INFO] Scraping Row Data...</span>`],
      ...(!deepScrape ? [] : [[8000, `<span class="log-warn">[WARN] Deep Scrape Initiated: Following inline links...</span>`]]),
      [9000, `<span class="log-info">[INFO] Calculating ROI Metrics...</span>`],
      [10500, `<span class="log-info">[INFO] ✓ Process Complete. Writing to Excel.</span>`]
    ];

    sequence.forEach(([delay, msg]) => {
      setTimeout(() => setLogs(prev => [...prev, msg]), delay);
    });

    setTimeout(() => setIsRunning(false), 11000);
  };

  return (
    <div className="fade-up" style={{padding: "28px 32px"}}>
      <div style={{display: "grid", gridTemplateColumns: "2fr 1fr", gap: 24}}>
        <div>
          <h3 style={{fontFamily: "Rajdhani", color: "#f59e0b", marginBottom: 16}}>SCRAPER SETTINGS</h3>
          
          <Toggle 
            label="Watch Browser (Visible Mode)" 
            desc="Disable for stealth/speed. Keep enabled to watch the script work."
            checked={!headless} onChange={() => setHeadless(!headless)} 
          />
          <Toggle 
            label="Deep Scrape Inline Links" 
            desc="Follow every blue link in the table to extract sub-item quantities. (Slow)"
            checked={deepScrape} onChange={() => setDeepScrape(!deepScrape)} 
          />
          
          <button 
            onClick={handleRun} 
            disabled={isRunning} 
            className={isRunning ? "" : "shimmer-btn"} 
            style={{
              marginTop: 20, width: "100%", border: "none", borderRadius: 10, padding: "16px",
              fontFamily: "Rajdhani", fontWeight: 700, fontSize: 16, 
              color: isRunning ? "#64748b" : "#080810", cursor: isRunning ? "not-allowed" : "pointer"
            }}
          >
            {isRunning ? "RUNNING SCRIPT..." : "▶ LAUNCH SCRAPER"}
          </button>
        </div>

        <div style={{background: "#05050A", border: "1px solid #1c1c2e", borderRadius: 12, display: "flex", flexDirection: "column", overflow: "hidden"}}>
          <div style={{background: "#0d0d1a", padding: "8px 16px", borderBottom: "1px solid #1c1c2e", fontSize: 11, fontFamily: "JetBrains Mono", color: "#64748b", display: "flex", justifyContent: "space-between"}}>
            <span>Terminal Output</span>
            {isRunning && <span style={{color: "#f59e0b"}}>● Live</span>}
          </div>
          <div ref={terminalRef} style={{padding: "16px", flex: 1, overflowY: "auto", height: "300px"}}>
            {logs.length === 0 ? (
              <div style={{color: "#334155", fontFamily: "JetBrains Mono", fontSize: 11}}>Awaiting execution...</div>
            ) : (
              logs.map((log, i) => <div key={i} className="log-line" dangerouslySetInnerHTML={{__html: log}} />)
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ResultsTab() {
  const manualMins = ITEMS.length * 2;
  const autoSecs = 10.5;
  const multiplier = Math.round((manualMins * 60) / autoSecs);

  return (
    <div className="fade-up" style={{padding: "20px 32px"}}>
      <div style={{display: "flex", gap: 16, marginBottom: 24}}>
        <div style={{flex: 1, background: "linear-gradient(135deg, #0d0d1a, #0a0a14)", border: "1px solid #1c1c2e", borderRadius: 12, padding: "20px", display: "flex", alignItems: "center", justifyContent: "space-between"}}>
          <div>
            <div style={{color: "#f59e0b", fontFamily: "Rajdhani", fontWeight: 700, fontSize: 14, letterSpacing: 1}}>R.O.I & TIME SAVED</div>
            <div style={{fontSize: 12, color: "#64748b", marginTop: 4}}>Estimated human time vs. Script execution</div>
          </div>
          <div style={{display: "flex", gap: 24, textAlign: "right"}}>
            <div>
              <div style={{fontSize: 10, color: "#64748b", fontFamily: "JetBrains Mono"}}>Manual Process</div>
              <div style={{fontSize: 20, color: "#ef4444", fontFamily: "Rajdhani", fontWeight: 600}}>{manualMins} mins</div>
            </div>
            <div>
              <div style={{fontSize: 10, color: "#64748b", fontFamily: "JetBrains Mono"}}>Automated Scraper</div>
              <div style={{fontSize: 20, color: "#34d399", fontFamily: "Rajdhani", fontWeight: 600}}>{autoSecs} secs</div>
            </div>
            <div style={{borderLeft: "1px solid #1c1c2e", paddingLeft: 24}}>
              <div style={{fontSize: 10, color: "#f59e0b", fontFamily: "JetBrains Mono"}}>Efficiency</div>
              <div style={{fontSize: 24, color: "#f59e0b", fontFamily: "Rajdhani", fontWeight: 700}}>{multiplier}x Faster</div>
            </div>
          </div>
        </div>
      </div>

      <div style={{overflowX: "auto", borderRadius: 10, border: "1px solid #1c1c2e"}}>
        <table style={{width: "100%", borderCollapse: "collapse"}}>
          <thead>
            <tr style={{background: "#0d0d1a", textAlign: "left", fontSize: 10, color: "#64748b", fontFamily: "JetBrains Mono"}}>
              <th style={{padding: 12}}>Line</th>
              <th style={{padding: 12}}>Code</th>
              <th style={{padding: 12}}>Description</th>
              <th style={{padding: 12}}>Qty</th>
              <th style={{padding: 12}}>Eng Est.</th>
            </tr>
          </thead>
          <tbody>
            {ITEMS.slice(0, 8).map((item) => (
              <tr key={item.id} style={{borderBottom: "1px solid #1c1c2e", fontSize: 12}}>
                <td style={{padding: 12, color: "#64748b", fontFamily: "JetBrains Mono"}}>{item.line}</td>
                <td style={{padding: 12, color: "#60a5fa", fontFamily: "JetBrains Mono"}}>{item.code}</td>
                <td style={{padding: 12, color: "#e2e8f0"}}>{item.desc}</td>
                <td style={{padding: 12, color: "#94a3b8", fontFamily: "JetBrains Mono"}}>{item.qty}</td>
                <td style={{padding: 12, color: "#f1f5f9", fontFamily: "JetBrains Mono"}}>{fmt$(item.eng)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{padding: 12, textAlign: "center", fontSize: 11, color: "#64748b", fontFamily: "JetBrains Mono", background: "#0d0d1a"}}>
          Showing 8 of {ITEMS.length} rows...
        </div>
      </div>
    </div>
  );
}

export default function ScraperCommandCenter() {
  const [activeTab, setActiveTab] = useState("configure");
  const[isRunning, setIsRunning] = useState(false);

  return (
    <div style={{minHeight: "100vh", background: "#080810", color: "#f1f5f9", display: "flex", flexDirection: "column"}}>
      <style dangerouslySetInnerHTML={{ __html: styles }} />

      <div style={{height: 60, background: "#0a0a14", borderBottom: "1px solid #1c1c2e", display: "flex", alignItems: "center", padding: "0 24px", gap: 16}}>
        <div style={{width: 32, height: 32, background: "linear-gradient(135deg,#f59e0b,#d97706)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16}}>🛣️</div>
        <div>
          <div style={{fontFamily: "Rajdhani", fontWeight: 700, fontSize: 18, letterSpacing: 1}}>ENTERPRISE COMMAND CENTER</div>
          <div style={{fontSize: 10, color: "#64748b", fontFamily: "JetBrains Mono"}}>IDOT / Scraper v3.0</div>
        </div>
      </div>

      <div style={{display: "flex", background: "#0a0a14", borderBottom: "1px solid #1c1c2e", padding: "0 24px"}}>
        {[
          { id: "configure", label: "⚙ Configuration & Terminal" },
          { id: "results", label: "📋 ROI & Bid Tab" }
        ].map(tab => (
          <button 
            key={tab.id} 
            onClick={() => setActiveTab(tab.id)} 
            className={activeTab === tab.id ? "tab-active" : ""} 
            style={{
              background: "none", border: "none", borderBottom: "2px solid transparent", padding: "16px 20px", cursor: "pointer",
              fontFamily: "Rajdhani", fontWeight: 600, fontSize: 14, color: activeTab === tab.id ? "#f59e0b" : "#64748b"
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div style={{flex: 1, overflowY: "auto"}}>
        {activeTab === "configure" && <ConfigureTab isRunning={isRunning} setIsRunning={setIsRunning} />}
        {activeTab === "results" && <ResultsTab />}
      </div>
    </div>
  );
}