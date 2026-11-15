import { Suspense, lazy, useEffect } from 'react';
import { Route, Switch, useLocation } from 'wouter';
import { Spinner } from '@cachet/react';
import { SessionProvider } from './lib/session.tsx';
import { Banner } from './components/Banner.tsx';
import { Header } from './components/Header.tsx';
import { Footer } from './components/Footer.tsx';
import { Home } from './pages/Home.tsx';
import { NotFound } from './pages/NotFound.tsx';

const Create = lazy(() => import('./pages/Create.tsx').then((m) => ({ default: m.Create })));
const Profile = lazy(() => import('./pages/Profile.tsx').then((m) => ({ default: m.Profile })));
const Lab = lazy(() => import('./pages/Lab.tsx').then((m) => ({ default: m.Lab })));
const SignRequest = lazy(() => import('./pages/SignRequest.tsx').then((m) => ({ default: m.SignRequest })));

const ScrollTop = () => {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);
  return null;
};

const PageLoader = () => (
  <div className="wrap" style={{ padding: '72px 28px', display: 'flex', justifyContent: 'center' }}>
    <Spinner />
  </div>
);

export const App = () => (
  <SessionProvider>
    <Switch>
      <Route path="/sign">
        <Suspense fallback={<PageLoader />}>
          <SignRequest />
        </Suspense>
      </Route>
      <Route>
        <ScrollTop />
        <Banner />
        <Header />
        <main>
          <Suspense fallback={<PageLoader />}>
            <Switch>
              <Route path="/" component={Home} />
              <Route path="/new" component={Create} />
              <Route path="/p/:id">{(p) => <Profile id={decodeURIComponent(p.id)} />}</Route>
              <Route path="/lab" component={Lab} />
              <Route component={NotFound} />
            </Switch>
          </Suspense>
        </main>
        <Footer />
      </Route>
    </Switch>
  </SessionProvider>
);
