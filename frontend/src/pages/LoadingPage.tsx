// Route: /loading — shown while the AI evaluation pipeline is processing a
// submitted video.
// TODO: poll or subscribe to the evaluation's `status` column and navigate to
// /result once it's `completed` (or show an error state if `failed`).

import { useState, useEffect } from 'react'

export default function LoadingPage() {

  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval)
          return 100
        }
        return prev + 1
      })
    }, 200)
    return () => clearInterval(interval)
  }, [])

  const isComplete = progress >= 100

  const files = [
    { name: 'Video_1.mp4', progress: 45, status: 'in-progress' },
    { name: 'Video_3.mp4', progress: 30, status: 'in-progress' },
    { name: 'Video_2.mp4', progress: 60, status: 'in-progress' },
    { name: 'Video_4.mp4', progress: 100, status: 'completed' },
  ]

  const analysisItems = [
    { label: 'Claim accuracy', desc: 'Verifies all claims against your product page' },
    { label: 'Storyline clarity', desc: 'Checks narrative flow and scene coherence' },
    { label: 'Brief alignment', desc: 'Compares ad against your creative brief' },
    { label: 'Product representation', desc: 'Confirms product appears correctly' },
    { label: 'Visual quality', desc: 'Detects artifacts, text readability, CTA' },
  ]

  return (
    // 固定宽高 100%，强制横向铺满
    <div style={{ width: '100vw', height: '100vh', backgroundColor: 'white', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      
      {/* ============================================================ */}
      {/* 顶部导航栏 */}
      {/* ============================================================ */}
      <header style={{ borderBottom: '1px solid #e2e8f0', backgroundColor: 'white', padding: '12px 24px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ height: '10px', width: '10px', borderRadius: '50%', backgroundColor: '#6366f1' }}></span>
            <div>
              <h1 style={{ fontSize: '20px', fontWeight: 'bold', color: '#6366f1' }}>AdReady AI</h1>
              <span style={{ fontSize: '14px', color: '#64748b' }}>Ship ads with confidence.</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ height: '8px', width: '8px', borderRadius: '50%', backgroundColor: '#22c55e' }}></span>
              <span style={{ color: '#16a34a', fontWeight: '500' }}>Provide Inputs</span>
            </div>
            <span style={{ color: '#cbd5e1' }}>→</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ height: '10px', width: '10px', borderRadius: '50%', backgroundColor: '#6366f1', animation: 'pulse 1.5s infinite' }}></span>
              <span style={{ color: '#6366f1', fontWeight: '600' }}>AI Review</span>
            </div>
            <span style={{ color: '#cbd5e1' }}>→</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ height: '8px', width: '8px', borderRadius: '50%', backgroundColor: '#cbd5e1' }}></span>
              <span style={{ color: '#94a3b8' }}>Results</span>
            </div>
          </div>
        </div>
      </header>

      {/* ============================================================ */}
      {/* 主内容 - 横向铺满 */}
      {/* ============================================================ */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '16px 24px', overflow: 'hidden' }}>
        
        {/* ---- 页面头部（进度条区域） ---- */}
        <div style={{ flexShrink: 0, marginBottom: '12px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: '600', color: 'black' }}>Reviewing your ad creatives...</h2>
          <p style={{ fontSize: '14px', color: '#64748b' }}>Hang tight — this usually takes 2–3 minutes. Don't close this tab.</p>
          <div style={{ marginTop: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '14px' }}>
              <span style={{ fontWeight: '500', color: isComplete ? '#16a34a' : '#334155' }}>
                {isComplete ? 'Complete!' : `${progress}% complete`}
              </span>
            </div>
            <div style={{ marginTop: '4px', height: '8px', width: '100%', borderRadius: '9999px', backgroundColor: '#e2e8f0' }}>
              <div
                style={{
                  height: '100%',
                  borderRadius: '9999px',
                  backgroundColor: isComplete ? '#22c55e' : '#6366f1',
                  transition: 'all 0.3s ease-out',
                  width: `${Math.min(progress, 100)}%`
                }}
              />
            </div>
          </div>
        </div>

        {/* ---- 水平两栏：3:2 比例 ---- */}
        <div style={{ flex: 1, display: 'flex', gap: '16px', minHeight: 0 }}>
          
          {/* ====== 左栏：占 3/5 ====== */}
          <div style={{ flex: 3, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            
            {/* 品牌标识 + 状态文案（居中） */}
            <div style={{ flexShrink: 0, marginBottom: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ position: 'relative', height: '112px', width: '112px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', backgroundColor: 'black' }}>
                <span style={{ fontFamily: 'sans-serif', fontSize: '72px', fontWeight: 'bold', color: '#6366f1', letterSpacing: '-0.05em', transform: 'translateY(-6px)' }}>A</span>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: 'translate(4px, 10px)' }}>
                  <svg width="36" height="42" viewBox="0 0 20 24" fill="none">
                    <polygon points="0,0 20,12 0,24" stroke="white" strokeWidth="3.5" fill="none" />
                  </svg>
                </div>
              </div>
              <div style={{ marginTop: '4px', textAlign: 'center' }}>
                <p style={{ fontSize: '14px', color: '#475569' }}>Analyzing your creatives...</p>
                <p style={{ fontSize: '12px', color: '#94a3b8' }}>This will take a couple of minutes; sit back and relax.</p>
              </div>
            </div>

            {/* 文件列表 */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px', borderRadius: '8px', border: '1px solid #e2e8f0', padding: '12px', overflow: 'auto' }}>
              {files.map((file, index) => (
                <div key={index}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '14px', color: 'black' }}>{file.name}</span>
                    <span style={{ fontSize: '12px' }}>
                      {file.status === 'completed' ? (
                        <span style={{ fontWeight: '500', color: '#16a34a' }}>Completed</span>
                      ) : (
                        <span style={{ color: '#64748b' }}>In Progress</span>
                      )}
                    </span>
                  </div>
                  <div style={{ marginTop: '2px', height: '6px', width: '100%', borderRadius: '9999px', backgroundColor: '#e2e8f0' }}>
                    <div
                      style={{
                        height: '100%',
                        borderRadius: '9999px',
                        backgroundColor: file.status === 'completed' ? '#22c55e' : '#6366f1',
                        transition: 'all 0.3s ease-out',
                        width: `${file.progress}%`
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Almost there! */}
            <div style={{ flexShrink: 0, marginTop: '8px', borderRadius: '8px', backgroundColor: '#eff6ff', padding: '8px 12px' }}>
              <p style={{ fontSize: '14px', fontWeight: '500', color: '#1e40af' }}>Almost there!</p>
              <p style={{ fontSize: '14px', color: '#1d4ed8' }}>We'll show you the ranked scorecard and repair recommendations once all checks are done.</p>
            </div>
          </div>

          {/* ====== 右栏：占 2/5 ====== */}
          <div style={{ flex: 2, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div style={{ flex: 1, borderRadius: '8px', border: '1px solid #e2e8f0', backgroundColor: 'white', padding: '16px', overflow: 'auto' }}>
              <h3 style={{ marginBottom: '8px', fontSize: '14px', fontWeight: '600', color: '#64748b' }}>What we'll analyze</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {analysisItems.map((item, index) => (
                  <div key={index}>
                    <p style={{ fontSize: '14px', fontWeight: '500', color: '#1e293b' }}>{item.label}</p>
                    <p style={{ fontSize: '12px', color: '#64748b' }}>{item.desc}</p>
                    {index < analysisItems.length - 1 && (
                      <div style={{ marginTop: '8px', borderTop: '1px solid #e2e8f0', paddingTop: '8px' }} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

        </div>
      </main>

      {/* 脉冲动画（内联 style 不支持 animation，加一个 style 标签） */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  )
}
