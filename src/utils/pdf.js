import { jsPDF } from 'jspdf'
import { fmtCOP, fmtDate, fmtMonthLabel } from './format'
import { T } from '../tokens'

export function generatePayrollPDF(emp, attendanceEntries, month) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })

  const pageW = 210
  const margin = 20
  const contentW = pageW - margin * 2

  // Colors
  const copperHex = '#C88F6A'
  const darkHex = '#252320'
  const grayHex = '#7A7163'
  const lightGrayHex = '#F2EDE6'

  // Header
  doc.setFillColor(37, 35, 32) // neutral 800
  doc.rect(0, 0, pageW, 45, 'F')

  doc.setTextColor(200, 143, 106) // copper 400
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text('TODY PAN', margin, 18)

  doc.setTextColor(255, 255, 255)
  doc.setFontSize(20)
  doc.text('Comprobante de Pago', margin, 30)

  doc.setTextColor(200, 143, 106)
  doc.setFontSize(10)
  doc.text(fmtMonthLabel(month), margin, 40)

  // Employee info card
  const cardY = 55
  doc.setFillColor(242, 237, 230)
  doc.roundedRect(margin, cardY, contentW, 38, 4, 4, 'F')

  doc.setTextColor(37, 35, 32)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text(emp.name, margin + 6, cardY + 12)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(122, 113, 99)
  doc.text(emp.role, margin + 6, cardY + 20)

  const branchName = emp.branch === 1 ? 'Panadería Iglesia' : 'Panadería Esquina'
  doc.text(branchName, margin + 6, cardY + 28)

  // Rate info
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(200, 143, 106)
  doc.setFontSize(11)
  doc.text(`${fmtCOP(emp.rate)} / día`, pageW - margin - 6, cardY + 12, { align: 'right' })

  // Worked days breakdown
  const tableY = cardY + 48
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(37, 35, 32)
  doc.text('Días trabajados', margin, tableY)

  // Table header
  const headerY = tableY + 8
  doc.setFillColor(200, 143, 106)
  doc.rect(margin, headerY, contentW, 8, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('Fecha', margin + 4, headerY + 5.5)
  doc.text('Día', margin + 60, headerY + 5.5)
  doc.text('Extras', margin + 100, headerY + 5.5)
  doc.text('Total', pageW - margin - 4, headerY + 5.5, { align: 'right' })
  doc.text('Estado', margin + 130, headerY + 5.5)

  // Table rows
  const sorted = [...attendanceEntries].sort((a, b) => a[0].localeCompare(b[0]))
  let y = headerY + 8
  let totalOwed = 0
  let totalPaid = 0

  sorted.forEach(([date, a], i) => {
    const rowTotal = emp.rate + (a.extras || 0)
    if (!a.paid) totalOwed += rowTotal
    else totalPaid += rowTotal

    const bg = i % 2 === 0 ? '#FFFFFF' : '#FDFBF8'
    doc.setFillColor(...hexToRgb(bg))
    doc.rect(margin, y, contentW, 7, 'F')

    doc.setTextColor(37, 35, 32)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(fmtDate(date, { weekday: true }), margin + 4, y + 5)
    doc.text(fmtCOP(emp.rate), margin + 60, y + 5)
    doc.text(a.extras > 0 ? fmtCOP(a.extras) : '—', margin + 100, y + 5)
    doc.text(fmtCOP(rowTotal), pageW - margin - 4, y + 5, { align: 'right' })

    if (a.paid) {
      doc.setTextColor(91, 138, 90)
      doc.setFont('helvetica', 'bold')
      doc.text('Pagado', margin + 130, y + 5)
    } else {
      doc.setTextColor(176, 78, 60)
      doc.setFont('helvetica', 'bold')
      doc.text('Pendiente', margin + 130, y + 5)
    }

    y += 7
  })

  // Totals section
  y += 8
  doc.setFillColor(37, 35, 32)
  doc.rect(margin, y, contentW, 0.5, 'F')
  y += 6

  const totals = [
    { label: 'Ya pagado', value: totalPaid, color: [91, 138, 90] },
    { label: 'Por pagar', value: totalOwed, color: [200, 143, 106], bold: true },
    { label: 'Total del mes', value: totalPaid + totalOwed, color: [37, 35, 32] },
  ]

  totals.forEach(t => {
    doc.setFont('helvetica', t.bold ? 'bold' : 'normal')
    doc.setFontSize(t.bold ? 13 : 11)
    doc.setTextColor(...t.color)
    doc.text(t.label, margin + 4, y)
    doc.text(fmtCOP(t.value), pageW - margin - 4, y, { align: 'right' })
    y += t.bold ? 10 : 8
  })

  // Footer
  const footerY = 275
  doc.setFillColor(242, 237, 230)
  doc.rect(0, footerY, pageW, 22, 'F')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(122, 113, 99)
  doc.text('Generado por TodyPan · ' + new Date().toLocaleDateString('es-CO'), pageW / 2, footerY + 8, { align: 'center' })
  doc.text('Este comprobante no tiene validez legal', pageW / 2, footerY + 15, { align: 'center' })

  return doc
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return [r, g, b]
}
