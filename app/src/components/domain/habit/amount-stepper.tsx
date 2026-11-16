import { useRef, useState } from 'react';
import { View } from 'react-native';
import { Minus } from '@/components/app-icons';
import { Button } from '@/components/ui/button';
import { Plus } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { describeAmountLimit, maxAmount } from '@/lib/cadence';
import { parseNumber } from '@/lib/number-draft';

/**
 * How much of a habit today held: one less, the number itself, one more.
 *
 * Every change is a total, never a step, so a retried or doubled request
 * records the same day. The box is typed into and sent once, when it is left
 * or Enter is pressed, because a goal of 10,000 steps is not reached by pressing
 * `+`. `+` does not stop at the goal: doing more than was asked is recorded.
 */
export function AmountStepper({
  habitName,
  amount,
  disabled,
  onAmountChange,
  onRefuse,
}: {
  /** The habit's name, for the controls' labels. */
  habitName: string;
  /** What today holds now; 0 for a day with nothing recorded. */
  amount: number;
  /** Whether the controls refuse a press: a write is on its way to the server. */
  disabled: boolean;
  /** Called with the day's new total. 0 means the day is cleared. */
  onAmountChange: (amount: number) => void;
  /** Called with why a typed value was not sent. */
  onRefuse: (reason: string) => void;
}) {
  // A ref as well as state: Enter and the blur after it would otherwise both send the draft.
  const draft = useRef<string | undefined>(undefined);
  const [text, setText] = useState<string | undefined>(undefined);

  const edit = (next: string) => {
    draft.current = next;
    setText(next);
  };

  const revert = () => {
    draft.current = undefined;
    setText(undefined);
  };

  const commit = () => {
    const typed = draft.current;
    revert();
    if (typed === undefined || typed.trim() === '') {
      return;
    }
    const total = parseNumber(typed, true);
    if (total === null || total < 0 || total > maxAmount()) {
      onRefuse(describeAmountLimit());
      return;
    }
    if (total !== amount) {
      onAmountChange(total);
    }
  };

  return (
    <View className="flex-row items-center gap-1">
      <Button
        aria-label={amount === 1 ? `Clear ${habitName} today` : `One less of ${habitName} today`}
        disabled={disabled || amount === 0}
        variant="outline"
        size="icon-sm"
        onPress={() => onAmountChange(amount - 1)}
        iconSlot={<Minus />}
      />
      <Input
        aria-label={`Amount of ${habitName} today`}
        inputMode="numeric"
        value={text ?? (amount > 0 ? String(amount) : '')}
        placeholder="0"
        disabled={disabled}
        onChangeText={edit}
        onSubmitEditing={commit}
        onBlur={commit}
        onEscape={revert}
        className="w-16 text-center tabular-nums"
      />
      <Button
        aria-label={`One more of ${habitName} today`}
        disabled={disabled || amount >= maxAmount()}
        variant="outline"
        size="icon-sm"
        onPress={() => onAmountChange(amount + 1)}
        iconSlot={<Plus />}
      />
    </View>
  );
}
