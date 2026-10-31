const generatedMarkup=new WeakMap<HTMLElement,string>();
/** Compare generated input, since DOM serialization may normalize SVG markup.
 * Key by the actual node: a reopened popup can reuse IDs with fresh elements. */
export function setGeneratedMarkup(node:HTMLElement,markup:string):void{
 if(generatedMarkup.get(node)===markup)return;
 node.innerHTML=markup;generatedMarkup.set(node,markup);
}
