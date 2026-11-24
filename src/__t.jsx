import React from "react"; import { createRoot } from "react-dom/client";
import { RequestWizard, CSS } from "./__AppT.jsx";
const sup=[{id:"s1",name:"Tеплодом",status:"active"}];
const P=(id,name,unit,cost)=>({id,name,unit,cost,price:cost*1.25,supplier_id:"s1",status:"active",brand:"Pro"});
const products=[P("p1","Труба ППР PN20 25 мм","м",0.9),P("p2","Кран шаровой 1/2\"","шт",3.2),P("p3","Тройник ППР 25","шт",0.4),P("p4","Коллектор 5 выходов","шт",28),P("p5","Радиатор алюм. 500","секц",6.5)];
const data={products,suppliers:sup,objects:[],masters:[],finance_ops:[],warehouse:[],wh_moves:[]};
createRoot(document.getElementById("r")).render(<div className="te fine"><style>{CSS}</style><div className="body"><RequestWizard data={data} reload={()=>{}} toast={()=>{}} openObject={()=>{}} /></div></div>);
