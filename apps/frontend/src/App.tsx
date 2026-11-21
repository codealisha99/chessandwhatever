import { useState } from 'react'
import './App.css'
import { BrowserRouter, Route, Routes } from 'react-router-dom'; 


function App() {
  const [count, setCount] = useState(0)

  return (
    <>
     <BrowserRouter>
     <Routes>
      <Route path= "/" element={<>Landing</>}></Route>
      <Route path= "/game" element={<>Game</>}></Route>
     </Routes>
     </BrowserRouter>
      
      <button className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">
        Join Game
      </button>
    </>
  )
}

export default App
