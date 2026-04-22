import { useState, useReducer, useCallback, useEffect } from 'react'
import { T } from './tokens'
import { getData, getBogotaHour, getBogotaDateStr, isDayConfirmed, initDB } from './db'
import { TabBar } from './components/Nav'
import Dashboard from './screens/Dashboard'
import Movements from './screens/Movements'
import AddMovement from './screens/AddMovement'
import Team from './screens/Team'
import Reports from './screens/Reports'
import Reminders from './screens/Reminders'
import More from './screens/More'
import Branches from './screens/Branches'
import DailyConfirmation, { DayEditModal } from './screens/DailyConfirmation'
import Registro from './screens/Registro'

export default function App() {
  const [tab, setTab] = useState('home')
  const [filter, setFilter] = useState('all')
  const [modal, setModal] = useState(null)
  const [moreSub, setMoreSub] = useState(null)
  const [pendingEmpId, setPendingEmpId] = useState(null)

  const [dbLoaded, setDbLoaded] = useState(false)
  // confirmingDate: fecha string para abrir DailyConfirmation (null = cerrado)
  // editingDate: fecha string para abrir DayEditModal (null = cerrado)
  const [confirmingDate, setConfirmingDate] = useState(null)
  const [editingDate, setEditingDate] = useState(null)

  useEffect(() => {
    initDB()
      .then(() => setDbLoaded(true))
      .catch(() => setDbLoaded(true))
  }, [])

  const [, forceUpdate] = useReducer(x => x + 1, 0)
  const refresh = useCallback(() => forceUpdate(), [])

  if (!dbLoaded) return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100dvh', background: '#FAF7F2', flexDirection: 'column', gap: 16,
    }}>
      <div style={{ fontSize: 52 }}>🥖</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#B08060', letterSpacing: 0.3 }}>Cargando TodyPan...</div>
    </div>
  )

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

  const activeTab = ['home','registro','team','more'].includes(tab) ? tab : 'more'

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
        onConfirmDay={() => setConfirmingDate(getBogotaDateStr())}
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
  } else if (tab === 'registro') {
    content = (
      <Registro
        employees={data.employees}
        attendance={data.attendance}
        onRefresh={refresh}
        onConfirmDay={date => setConfirmingDate(date)}
        onEditDay={date => setEditingDate(date)}
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
    if (moreSub === 'movements') {
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
    } else if (moreSub === 'reports') {
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
      position: 'relative',
    }}>
      <div style={{ minHeight: '100dvh', WebkitOverflowScrolling: 'touch', position: 'relative' }}>
        {content}
      </div>

      <TabBar active={activeTab} onChange={handleTabChange} />

      {/* Formulario de confirmación — funciona para cualquier fecha */}
      {confirmingDate && (
        <DailyConfirmation
          date={confirmingDate}
          employees={data.employees}
          attendance={data.attendance}
          onDone={() => { setConfirmingDate(null); refresh() }}
          onRefresh={refresh}
        />
      )}

      {/* Edición de día ya confirmado */}
      {editingDate && (
        <DayEditModal
          date={editingDate}
          employees={data.employees}
          attendance={data.attendance}
          onDone={() => { setEditingDate(null); refresh() }}
          onRefresh={refresh}
        />
      )}

      {modal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 80,
          background: T.neutral[50],
          animation: 'slideUp 0.28s cubic-bezier(0.2,0.9,0.3,1.2)',
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
