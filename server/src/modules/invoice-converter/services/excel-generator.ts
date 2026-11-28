import ExcelJS from 'exceljs';

export interface ExcelExportRowInput {
  name: string;
  size?: string | null;
  sizeWeightVolume?: string | null;
  variant?: string | null;
  costPrice: string;
  openingStock: string;
  // Optional legacy fields
  uom?: string;
  sellingPrice?: string;
  hsn?: string;
  gstRate?: string;
  priceInclusive?: 'Yes' | 'No' | string;
}

/**
 * Generates the exact 4-column Excel template:
 * 1. Product Name
 * 2. Size
 * 3. Cost
 * 4. Stock
 */
export async function generateTemplateExcel(products: ExcelExportRowInput[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Adaptive Billing Software';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('Supplier Products', {
    views: [{ showGridLines: true }],
  });

  worksheet.columns = [
    { header: 'Product Name', key: 'productName', width: 38 },
    { header: 'Size', key: 'size', width: 16 },
    { header: 'Cost', key: 'cost', width: 16 },
    { header: 'Stock', key: 'stock', width: 14 },
  ];

  const headerRow = worksheet.getRow(1);
  headerRow.height = 26;
  headerRow.font = {
    name: 'Calibri',
    size: 11,
    bold: true,
    color: { argb: 'FFFFFFFF' },
  };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF49364A' },
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  worksheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left' };

  for (let i = 0; i < products.length; i++) {
    const p = products[i];

    const cpNum = p.costPrice ? parseFloat(String(p.costPrice).replace(/,/g, '')) : null;
    const stockNum = p.openingStock ? parseFloat(String(p.openingStock).replace(/,/g, '')) : 0;
    const sizeVal = (p.size ?? p.sizeWeightVolume ?? p.variant ?? '').trim();

    const row = worksheet.addRow({
      productName: (p.name || '').trim(),
      size: sizeVal,
      cost: cpNum !== null && !isNaN(cpNum) ? cpNum : '',
      stock: !isNaN(stockNum) ? stockNum : 0,
    });

    row.height = 20;

    row.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
    row.getCell(2).alignment = { vertical: 'middle', horizontal: 'center' };
    row.getCell(3).alignment = { vertical: 'middle', horizontal: 'right' };
    row.getCell(4).alignment = { vertical: 'middle', horizontal: 'right' };

    if (cpNum !== null && !isNaN(cpNum)) {
      row.getCell(3).numFmt = '#,##0.00';
    }
    if (!isNaN(stockNum)) {
      row.getCell(4).numFmt = '#,##0';
    }
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
