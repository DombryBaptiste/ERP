import { Pipe, PipeTransform } from '@angular/core';
import { ATTACHMENT_KIND_LABELS, CONDITION_LABELS, ITEM_TYPE_LABELS, PAYMENT_LABELS, PLATFORM_LABELS } from '../core/labels';

type LabelKind = 'type' | 'condition' | 'platform' | 'payment' | 'attachment';

const LABELS: Record<LabelKind, Record<string, string>> = {
  type: ITEM_TYPE_LABELS,
  condition: CONDITION_LABELS,
  platform: PLATFORM_LABELS,
  payment: PAYMENT_LABELS,
  attachment: ATTACHMENT_KIND_LABELS
};

/**
 * Traduit une valeur technique en libellé français.
 * Usage : {{ item.type | label:'type' }}, {{ sale.platform | label:'platform' }}, {{ sale.paymentMethod | label:'payment' }}
 */
@Pipe({ name: 'label' })
export class LabelPipe implements PipeTransform {
  transform(value: string | null | undefined, kind: LabelKind): string {
    if (!value) return '';
    return LABELS[kind][value] ?? value;
  }
}
