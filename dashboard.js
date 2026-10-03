chrome.runtime.sendMessage(
{
 type:"getData"
},
(data)=>{

 renderStats(data.stats);

 renderProducts(
   data.products
 );

});
function renderStats(stats){

 document.getElementById(
  "stats"
 ).innerHTML=`

 <div class="card">
  Products: ${stats.tracked}
 </div>

 <div class="card">
  Available: ${stats.available}
 </div>

 <div class="card">
  Launches: ${stats.launches}
 </div>

 `;

}
function renderProducts(products){

 const container =
 document.getElementById(
  "products"
 );

 container.innerHTML="";

 products.forEach(product=>{

  const div =
   document.createElement("div");

  div.className="card";

div.innerHTML=`
   <h3>${product.title}</h3>

   <p>
   Qty:
   ${product.quantity || 0}
   </p>

   <p>
   Status:
   ${
     product.available
     ? "✅ In Stock"
     : "❌ Sold Out"
   }
   </p>

   <p>
   Trend:
   ${product.analytics?.trendingLevel || "😴 QUIET"}
   </p>

   <p>
   Health:
   ${product.analytics?.healthScore || 0}/100
   </p>
`;
  container.appendChild(div);

 });

}