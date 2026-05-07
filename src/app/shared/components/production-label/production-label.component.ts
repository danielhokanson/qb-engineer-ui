import { ChangeDetectionStrategy, Component, inject, input, signal, OnInit } from '@angular/core';
import { LabelPrintService } from '../../services/label-print.service';

export interface LabelData {
  title: string;
  subtitle?: string;
  barcodeValue: string;
  barcodeType?: 'code128' | 'qrcode';
  fields?: { label: string; value: string }[];
}

@Component({
  selector: 'app-production-label',
  standalone: true,
  templateUrl: './production-label.component.html',
  styleUrl: './production-label.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductionLabelComponent implements OnInit {
  private readonly labelPrint = inject(LabelPrintService);

  readonly label = input.required<LabelData>();
  readonly size = input<'small' | 'medium' | 'large'>('medium');

  protected readonly barcodeDataUrl = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    const data = this.label();
    const type = data.barcodeType ?? 'code128';
    try {
      const url = await this.labelPrint.generateBarcodeDataUrl(data.barcodeValue, type);
      this.barcodeDataUrl.set(url);
    } catch {
      this.barcodeDataUrl.set(null);
    }
  }

  async print(): Promise<void> {
    const data = this.label();
    await this.labelPrint.printLabels([{
      type: (data.barcodeType ?? 'code128') === 'qrcode' ? 'qr' : 'barcode',
      value: data.barcodeValue,
      label: data.title,
      sublabel: data.subtitle,
    }]);
  }
}
