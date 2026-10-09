// Formulation Test Tracker — the pages and their addresses.
//
//   /login          sign in with name and PIN
//   /               the board (both sides)
//   /add            Add Formulation (Hi-Tech Company)
//   /queue          Test Queue (Manna lab)
//   /test/:id       Conduct Test for one formulation (Manna lab)
//   /history        Test Result History (both sides)
//   /users          accounts and PINs (administrators)
//   /report/:id     the printable test report
//
// The addresses of the earlier version (report.html?id=…, test.html?id=…,
// queue.html, …) still work, for bookmarks and links already sent.

import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router";
import { SessionProvider } from "./context/session.jsx";
import { ToastProvider } from "./context/toast.jsx";
import { RequireSignIn } from "./components/Layout.jsx";
import Login from "./pages/Login.jsx";
import Board from "./pages/Board.jsx";
import AddFormulation from "./pages/AddFormulation.jsx";
import Queue from "./pages/Queue.jsx";
import ConductTest from "./pages/ConductTest.jsx";
import History from "./pages/History.jsx";
import Users from "./pages/Users.jsx";
import Report from "./pages/Report.jsx";

var OLD_PAGES = { "/index.html": "/", "/add.html": "/add", "/queue.html": "/queue", "/history.html": "/history", "/users.html": "/users", "/login.html": "/login" };

// report.html?id=X -> /report/X, test.html?id=X -> /test/X, queue.html -> /queue, ...
function OldAddress() {
  var { pathname, search } = useLocation();
  var params = new URLSearchParams(search);
  var id = params.get("id");
  if ((pathname === "/report.html" || pathname === "/test.html") && id) {
    return <Navigate to={(pathname === "/report.html" ? "/report/" : "/test/") + encodeURIComponent(id)} replace />;
  }
  if (OLD_PAGES[pathname]) return <Navigate to={OLD_PAGES[pathname] + (pathname === "/login.html" ? search : "")} replace />;
  return <Navigate to="/" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <SessionProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/report/:id" element={<Report />} />
            <Route element={<RequireSignIn />}>
              <Route path="/" element={<Board />} />
              <Route path="/add" element={<AddFormulation />} />
              <Route path="/queue" element={<Queue />} />
              <Route path="/test/:id" element={<ConductTest />} />
              <Route path="/history" element={<History />} />
              <Route path="/users" element={<Users />} />
            </Route>
            <Route path="*" element={<OldAddress />} />
          </Routes>
        </SessionProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
