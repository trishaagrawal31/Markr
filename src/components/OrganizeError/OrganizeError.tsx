import { WarningIcon, RefreshIcon } from '../icons/Icons';
import OrganizeStatusView from '../OrganizeStatusView/OrganizeStatusView';
import Button from '../Button/Button';

interface OrganizeErrorProps {
  errorMessage: string | null;
  onReset: () => void;
}

const isTransientError = (message: string | null): boolean => {
  if (!message) return false;
  const lower = message.toLowerCase();
  return lower.includes('high demand') || lower.includes('rate limit') || lower.includes('temporarily unavailable') || lower.includes('try again');
};

const OrganizeError = ({ errorMessage, onReset }: OrganizeErrorProps) => {
  const isTransient = isTransientError(errorMessage);

  return (
    <OrganizeStatusView
      icon={<WarningIcon width={20} height={20} />}
      title={isTransient ? 'Please try again' : 'Something went wrong'}
      description={errorMessage || 'An unexpected error occurred'}
    >
      <Button onClick={onReset} fullWidth>
        <RefreshIcon />
        {isTransient ? 'Retry' : 'Try Again'}
      </Button>
    </OrganizeStatusView>
  );
};

export default OrganizeError;
