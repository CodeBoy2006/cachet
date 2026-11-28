import { Suspense, lazy, useEffect } from 'react';
import { Route, Switch, useLocation } from 'wouter';
import { Spinner } from '@cachet/react';
import { SessionProvider } from './lib/session.tsx';
import { Header } from './components/Header.tsx';
import { Footer } from './components/Footer.tsx';
import { Home } from './pages/Home.tsx';
import { NotFound } from './pages/NotFound.tsx';

const loadCreate = () => import('./pages/Create.tsx').then((m) => ({ default: m.Create }));
const loadProfile = () => import('./pages/Profile.tsx').then((m) => ({ default: m.Profile }));
const loadLab = () => import('./pages/Lab.tsx').then((m) => ({ default: m.Lab }));
const loadSignRequest = () => import('./pages/SignRequest.tsx').then((m) => ({ default: m.SignRequest }));

const Create = lazy(loadCreate);
const Profile = lazy(loadProfile);
const Lab = lazy(loadLab);
const SignRequest = lazy(loadSignRequest);

const ScrollTop = () => {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);
  useEffect(() => {
    const t = setTimeout(() => {
      void loadCreate();
      void loadProfile();
      void loadLab();
    }, 240);
    return () => clearTimeout(t);
  }, []);
  return null;
};

const PageLoader = () => (
  <div className="wrap page-loader">
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
