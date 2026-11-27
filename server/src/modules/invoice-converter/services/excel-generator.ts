import ExcelJS from 'exceljs';

export interface ExcelExportRowInput {
  name: string;
  uom: string;
  sellingPrice: string;
  costPrice: string;
  hsn: string;
  gstRate: string;
  priceInclusive?: 'Yes' | 'No' | string;
  openingStock: string;
}

/**
 * Generates the exact 8-column Excel template compatible with BulkImportModal:
 * 1. Product Name
 * 2. UOM
 * 3. Selling Price
 * 4. Cost Price
 * 5. HSN
 * 6. GST Rate
 * 7. Price Inclusive of GST
 * 8. Opening Stock
 */
export async function generateTemplateExcel(products: ExcelExportRowInput[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Adaptive Billing Software';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('Supplier Products', {
    views: [{ showGridLines: true }],
  });

  worksheet.columns = [
    { header: 'Product Name', key: 'productName', width: 34 },
    { header: 'UOM', key: 'uom', width: 12 },
    { header: 'Selling Price', key: 'sellingPrice', width: 16 },
    { header: 'Cost Price', key: 'costPrice', width: 16 },
    { header: 'HSN', key: 'hsn', width: 14 },
    { header: 'GST Rate', key: 'gstRate', width: 14 },
    { header: 'Price Inclusive of GST', key: 'priceInclusive', width: 20 },
    { header: 'Opening Stock', key: 'openingStock', width: 16 },
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

    const spNum = p.sellingPrice ? parseFloat(p.sellingPrice) : null;
    const cpNum = p.costPrice ? parseFloat(p.costPrice) : null;
    const stockNum = p.openingStock ? parseFloat(p.openingStock) : 0;
    const priceIncl = p.priceInclusive === 'No' ? 'No' : 'Yes';

    const row = worksheet.addRow({
      productName: p.name || '',
      uom: p.uom || 'PCS',
      sellingPrice: spNum !== null && !isNaN(spNum) ? spNum : '',
      costPrice: cpNum !== null && !isNaN(cpNum) ? cpNum : '',
      hsn: p.hsn ? String(p.hsn) : '',
      gstRate: p.gstRate || '5%',
      priceInclusive: priceIncl,
      openingStock: !isNaN(stockNum) ? stockNum : 0,
    });

    row.height = 20;

    row.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
    row.getCell(2).alignment = { vertical: 'middle', horizontal: 'center' };
    row.getCell(3).alignment = { vertical: 'middle', horizontal: 'right' };
    row.getCell(4).alignment = { vertical: 'middle', horizontal: 'right' };
    row.getCell(5).alignment = { vertical: 'middle', horizontal: 'center' };
    row.getCell(6).alignment = { vertical: 'middle', horizontal: 'center' };
    row.getCell(7).alignment = { vertical: 'middle', horizontal: 'center' };
    row.getCell(8).alignment = { vertical: 'middle', horizontal: 'right' };

    if (spNum !== null && !isNaN(spNum)) {
      row.getCell(3).numFmt = '#,##0.00';
    }
    if (cpNum !== null && !isNaN(cpNum)) {
      row.getCell(4).numFmt = '#,##0.00';
    }
    if (!isNaN(stockNum)) {
      row.getCell(8).numFmt = '#,##0';
    }
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
