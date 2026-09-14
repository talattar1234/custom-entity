import type { Preview } from '@storybook/react-vite';

// The app's base styles (font, reset) and MagicChat's own component stylesheet.
// `src/main.tsx` loads exactly these two for the real app.
import '../src/styles.css';
import '../src/magic-chat/magic-chat.css';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },

    a11y: {
      // 'todo' - show a11y violations in the test UI only
      // 'error' - fail CI on a11y violations
      // 'off' - skip a11y checks entirely
      test: 'todo',
    },
  },
};

export default preview;
