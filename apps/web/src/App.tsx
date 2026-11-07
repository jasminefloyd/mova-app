import { RouterProvider } from 'react-router';
import { router } from './router';
import { AppErrorBoundary } from './app/AppErrorBoundary';

export function App() {
  return (
    <AppErrorBoundary>
      <RouterProvider router={router} />
    </AppErrorBoundary>
  );
}
