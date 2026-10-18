import { Pipe, PipeTransform } from '@angular/core';
import {
  ATTACHMENT_KIND_LABELS, CARRIER_LABELS, CONDITION_LABELS, ITEM_TYPE_LABELS, PAYMENT_LABELS, PLATFORM_LABELS, SHIPPING_KIND_LABELS
} from '../core/labels';

type LabelKind = 'type' | 'condition' | 'platform' | 'payment' | 'attachment' | 'shippingKind' | 'carrier';

const LABELS: Record<LabelKind, Record<string, string>> = {
  type: ITEM_TYPE_LABELS,
  condition: CONDITION_LABELS,
  platform: PLATFORM_LABELS,
  payment: PAYMENT_LABELS,
  attachment: ATTACHMENT_KIND_LABELS,
  shippingKind: SHIPPING_KIND_LABELS,
  carrier: CARRIER_LABELS
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
