import { useState, useReducer, useCallback } from 'react'
import { T } from './tokens'
import { getData } from './db'
import { TabBar } from './components/Nav'
import Dashboard from './screens/Dashboard'
import Movements from './screens/Movements'
import AddMovement from './screens/AddMovement'
import Team from './screens/Team'
import Reports from './screens/Reports'
import Reminders from './screens/Reminders'
import More from './screens/More'
import Categories from './screens/Categories'
import Branches from './screens/Branches'

export default function App() {
  const [tab, setTab] = useState('home')
  const [filter, setFilter] = useState('all')
  const [modal, setModal] = useState(null)
  const [moreSub, setMoreSub] = useState(null)
  const [pendingEmpId, setPendingEmpId] = useState(null)

  const [, forceUpdate] = useReducer(x => x + 1, 0)
  const refresh = useCallback(() => forceUpdate(), [])

  const data = getData()

  function handleNav(target, meta) {
    if (target === 'add') {
      setModal({ kind: meta?.kind || 'income' })
    } else if (target === 'emp') {
      setPendingEmpId(meta?.empId)
      setTab('team')
    } else if (target === 'reminders') {
      setMoreSub('reminders')
      setTab('more')
    } else {
      setTab(target)
    }
  }

  function handleTabChange(t) {
    if (t === 'add') {
      setModal({ kind: 'income' })
      return
    }
    setMoreSub(null)
    setPendingEmpId(null)
    setTab(t)
  }

  const activeTab = ['home','movements','team','more'].includes(tab) ? tab : 'more'

  let content
  if (tab === 'home') {
    content = (
      <Dashboard
        onNav={handleNav}
        filter={filter}
        setFilter={setFilter}
        movements={data.movements}
        employees={data.employees}
        attendance={data.attendance}
        reminders={data.reminders}
      />
    )
  } else if (tab === 'movements') {
    content = (
      <Movements
        filter={filter}
        setFilter={setFilter}
        movements={data.movements}
        incomeCats={data.incomeCats}
        expenseCats={data.expenseCats}
        onNav={handleNav}
        onRefresh={refresh}
      />
    )
  } else if (tab === 'team') {
    content = (
      <Team
        filter={filter}
        setFilter={setFilter}
        employees={data.employees}
        attendance={data.attendance}
        onRefresh={refresh}
        initialEmpId={pendingEmpId}
        onClearEmpId={() => setPendingEmpId(null)}
      />
    )
  } else if (tab === 'more') {
    if (moreSub === 'reports') {
      content = (
        <Reports
          filter={filter}
          setFilter={setFilter}
          movements={data.movements}
          employees={data.employees}
          attendance={data.attendance}
          incomeCats={data.incomeCats}
          expenseCats={data.expenseCats}
          onBack={() => setMoreSub(null)}
        />
      )
    } else if (moreSub === 'reminders') {
      content = (
        <Reminders
          reminders={data.reminders}
          onBack={() => setMoreSub(null)}
          onRefresh={refresh}
        />
      )
    } else if (moreSub === 'categories') {
      content = (
        <Categories
          incomeCats={data.incomeCats}
          expenseCats={data.expenseCats}
          onBack={() => setMoreSub(null)}
          onRefresh={refresh}
        />
      )
    } else if (moreSub === 'branches') {
      content = (
        <Branches
          branches={data.branches}
          onBack={() => setMoreSub(null)}
          onRefresh={refresh}
        />
      )
    } else {
      content = <More onOpen={id => setMoreSub(id)} />
    }
  }

  return (
    <div style={{
      minHeight: '100dvh',
      background: T.neutral[50],
      fontFamily: '-apple-system, "SF Pro Text", "Inter", system-ui, sans-serif',
      color: T.neutral[800],
      maxWidth: 480,
      margin: '0 auto',
      position: 'relative',
    }}>
      <div style={{ minHeight: '100dvh', WebkitOverflowScrolling: 'touch', position: 'relative' }}>
        {content}
      </div>

      <TabBar active={activeTab} onChange={handleTabChange} />

      {modal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 80,
          background: T.neutral[50],
          animation: 'slideUp 0.28s cubic-bezier(0.2,0.9,0.3,1.2)',
          maxWidth: 480, margin: '0 auto',
        }}>
          <AddMovement
            initialKind={modal.kind}
            onBack={() => setModal(null)}
            onSave={() => { setModal(null); refresh() }}
            incomeCats={data.incomeCats}
            expenseCats={data.expenseCats}
          />
        </div>
      )}

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); opacity: 0.9; }
          to { transform: translateY(0); opacity: 1; }
        }
        * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
        body { margin: 0; background: ${T.neutral[100]}; }
        button:active { opacity: 0.75; }
        input[type="date"]::-webkit-calendar-picker-indicator { opacity: 0.6; cursor: pointer; }
        ::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  )
}
