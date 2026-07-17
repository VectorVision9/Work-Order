// =========================================================
// Kruti Dev <-> Unicode Hindi Font Converter
// Conversion logic sourced from the UP govt e-Sathi tool
// (https://updes.up.nic.in/esd/font_converter/), embedded
// as-is; only the surrounding UI has been restyled.
// =========================================================
function clear_data_legacy(){
document.getElementById('legacy_text').value="";
}

function copy_data_legacy(){
document.getElementById('legacy_text').select();
 document.execCommand('copy');
}

function clear_data_unicode(){
document.getElementById('unicode_text').value="";
}

function copy_data_unicode(){
document.getElementById('unicode_text').select();
 document.execCommand('copy');
}





var myTimer;function setTimer(){
document.getElementById("loadDiv1").style.display="none";
document.getElementById("loadDiv2").style.display="none";
myTimer=setTimeout("showLoad()", 100);}
function showLoad(){
document.getElementById("loadDiv1").style.display="none";
document.getElementById("loadDiv2").style.display="none";
clearTimeout(myTimer);}

function corrections(){
el = document.getElementById("legacy_text")
txt = el.value;
el.value = "";
txt = txt.replace(/’/g, "'");
el.value = txt;
delete txt;
convert_to_unicode();
}
function convert_to_unicode()
{
setTimer();

var array_one = new Array(//"kZsa", 
// "(",")", 
"ñ","Q+Z","sas","aa",")Z","ZZ","‘","’","“","”",

"å","ƒ","„","…","†","‡","ˆ","‰","Š","‹", 

"¶+","d+","[+k","[+","x+","T+","t+","M+","<+","Q+",";+","j+","u+",
"Ùk","Ù","ä","–","—","é","™","=kk","f=k",  

"à","á","â","ã","ºz","º","í","{k","{","=","«",   
"Nî","Vî","Bî","Mî","<î","|","K","}",
"J","Vª","Mª","<ªª","Nª","Ø","Ý","nzZ","æ","ç","Á","xz","#",":",

"v‚","vks","vkS","vk","v","b±","Ã","bZ","b","m","Å",",s",",","_",

"ô","d","Dk","D","£","[k","[","x","Xk","X","Ä","?k","?","³", 
"p","Pk","P","N","t","Tk","T",">","÷","¥",

"ê","ë","V","B","ì","ï","M+","<+","M","<",".k",".",    
"r","Rk","R","Fk","F",")","n","/k","èk","/","Ë","è","u","Uk","U",   

"i","Ik","I","Q","¶","c","Ck","C","Hk","H","e","Ek","E",
";","¸","j","y","Yk","Y","G","o","Ok","O",
"'k","'","\"k","\"","l","Lk","L","g", 

"È","z", 
"Ì","Í","Î","Ï","Ñ","Ò","Ó","Ô","Ö","Ø","Ù","Ük","Ü",

"‚","¨","ks","©","kS","k","h","q","w","`","s","¢","S",
"a","¡","%","W","•","·","∙","·","~j","~","\\","+"," ः",
"^","*","Þ","ß","(","¼","½","¿","À","¾","A","-","&","&","Œ","]","~ ","@",
"ाे","ाॅ","ंै","े्र","अौ","अो","आॅ")

var array_two = new Array(//"ksaZ",
//"¼","½", 
"॰","QZ+","sa","a","र्द्ध","Z","\"","\"","'","'",

"०","१","२","३","४","५","६","७","८","९",   

"फ़्","क़","ख़","ख़्","ग़","ज़्","ज़","ड़","ढ़","फ़","य़","ऱ","ऩ",    // one-byte nukta varNas
"त्त","त्त्","क्त","दृ","कृ","न्न","न्न्","=k","f=",

"ह्न","ह्य","हृ","ह्म","ह्र","ह्","द्द","क्ष","क्ष्","त्र","त्र्", 
"छ्य","ट्य","ठ्य","ड्य","ढ्य","द्य","ज्ञ","द्व",
"श्र","ट्र","ड्र","ढ्र","छ्र","क्र","फ्र","र्द्र","द्र","प्र","प्र","ग्र","रु","रू",

"ऑ","ओ","औ","आ","अ","ईं","ई","ई","इ","उ","ऊ","ऐ","ए","ऋ",

"क्क","क","क","क्","ख","ख","ख्","ग","ग","ग्","घ","घ","घ्","ङ",
"च","च","च्","छ","ज","ज","ज्","झ","झ्","ञ",

"ट्ट","ट्ठ","ट","ठ","ड्ड","ड्ढ","ड़","ढ़","ड","ढ","ण","ण्",   
"त","त","त्","थ","थ्","द्ध","द","ध","ध","ध्","ध्","ध्","न","न","न्",    

"प","प","प्","फ","फ्","ब","ब","ब्","भ","भ्","म","म","म्",  
"य","य्","र","ल","ल","ल्","ळ","व","व","व्",   
"श","श्","ष","ष्","स","स","स्","ह", 

"ीं","्र",    
"द्द","ट्ट","ट्ठ","ड्ड","कृ","भ","्य","ड्ढ","झ्","क्र","त्त्","श","श्",

"ॉ","ो","ो","ौ","ौ","ा","ी","ु","ू","ृ","े","े","ै",
"ं","ँ","ः","ॅ","ऽ","ऽ","ऽ","ऽ","्र","्","?","़",":",
"‘","’","“","”",";","(",")","{","}","=","।",".","-","µ","॰",",","् ","/",
"ो","ॉ","ैं","्रे","औ","ओ","ऑ")

//Corrections for Spelling mistakes (see above under the first Array):
// "sas","aa","ZZ","=kk","f=k",
//
// The following two characters are to be replaced through proper checking of locations:
// "Z" )
// "र्" (reph) 

// "f" )
// "ि"  


var array_one_length = array_one.length ;

var modified_substring = document.getElementById("legacy_text").value  ;

//****************************************************************************************
//  Break the long text into small bunches of max. max_text_size  characters each.
//****************************************************************************************
    var text_size = document.getElementById("legacy_text").value.length ;

    var processed_text = '' ;  //blank

    var sthiti1 = 0 ;  var sthiti2 = 0 ;  var chale_chalo = 1 ;
 
    var max_text_size = 6000;

    while ( chale_chalo == 1 ) 
    {
     sthiti1 = sthiti2 ;

     if ( sthiti2 < ( text_size - max_text_size ) )  
     { 
      sthiti2 +=  max_text_size ;
      while (document.getElementById("legacy_text").value.charAt ( sthiti2 ) != ' ') {sthiti2--;}
     } 
     else  { sthiti2 = text_size  ;  chale_chalo = 0 }

     var modified_substring = document.getElementById("legacy_text").value.substring ( sthiti1, sthiti2 )  ;

    Replace_Symbols( ) ;

    processed_text += modified_substring ;

//****************************************************************************************
//  Breaking part code over
//****************************************************************************************
//  processed_text = processed_text.replace( /mangal/g , "Krutidev010" ) ;   

    document.getElementById("unicode_text").value = processed_text  ;
   }


// --------------------------------------------------

function Replace_Symbols( )
{

//substitute array_two elements in place of corresponding array_one elements

if ( modified_substring != "" )  // if stringto be converted is non-blank then no need of any processing.
{
for ( input_symbol_idx = 0;   input_symbol_idx < array_one_length;    input_symbol_idx++ )

{

idx = 0  ;  // index of the symbol being searched for replacement

while (idx != -1 ) //whie-00
{

modified_substring = modified_substring.replace( array_one[ input_symbol_idx ] , array_two[input_symbol_idx] )
idx = modified_substring.indexOf( array_one[input_symbol_idx] )

} // end of while-00 loop
} // end of for loop

//**********************************************************************************
// Code for Replacing five Special glyphs
//**********************************************************************************

//**********************************************************************************
// Code for Glyph1 : ± (reph+anusvAr)
//**********************************************************************************
   modified_substring = modified_substring.replace( /±/g , "Zं" ) ; // at some places  ì  is  used eg  in "कर्कंधु,पूर्णांक".
//
//**********************************************************************************
// Glyp2: Æ
// code for replacing "f" with "ि" and correcting its position too. (moving it one position forward)
//**********************************************************************************

modified_substring = modified_substring.replace( /Æ/g , "र्f" ) ;  // at some places  Æ  is  used eg  in "धार्मिक".

var position_of_i = modified_substring.indexOf( "f" )

while ( position_of_i != -1 )  //while-02
{
var character_next_to_i = modified_substring.charAt( position_of_i + 1 )
var character_to_be_replaced = "f" + character_next_to_i
modified_substring = modified_substring.replace( character_to_be_replaced , character_next_to_i + "ि" ) 
position_of_i = modified_substring.search( /f/ , position_of_i + 1 ) // search for i ahead of the current position.

} // end of while-02 loop

//**********************************************************************************
// Glyph3 & Glyph4: Ç  É
// code for replacing "fa" with "िं"  and correcting its position too.(moving it two positions forward)
//**********************************************************************************

modified_substring = modified_substring.replace( /Ç/g , "fa" ) ; // at some places  Ç  is  used eg  in "किंकर".
modified_substring = modified_substring.replace( /É/g , "र्fa" ) ; // at some places  É  is  used eg  in "शर्मिंदा"

var position_of_i = modified_substring.indexOf( "fa" )

while ( position_of_i != -1 )  //while-02
{
var character_next_to_ip2 = modified_substring.charAt( position_of_i + 2 )
var character_to_be_replaced = "fa" + character_next_to_ip2
modified_substring = modified_substring.replace( character_to_be_replaced , character_next_to_ip2 + "िं" ) 
position_of_i = modified_substring.search( /fa/ , position_of_i + 2 ) // search for i ahead of the current position.

} // end of while-02 loop

//**********************************************************************************
// Glyph5: Ê
// code for replacing "h" with "ी"  and correcting its position too.(moving it one positions forward)
//**********************************************************************************

modified_substring = modified_substring.replace( /Ê/g , "ीZ" ) ; // at some places  Ê  is  used eg  in "किंकर".


/*
var position_of_i = modified_substring.indexOf( "h" )

while ( position_of_i != -1 )  //while-02
{
var character_next_to_i = modified_substring.charAt( position_of_i + 1 )
var character_to_be_replaced = "h" + character_next_to_i
modified_substring = modified_substring.replace( character_to_be_replaced , character_next_to_i + "ी" ) 
position_of_i = modified_substring.search( /h/ , position_of_i + 1 ) // search for i ahead of the current position.

} // end of while-02 loop
*/


//**********************************************************************************
// End of Code for Replacing four Special glyphs
//**********************************************************************************

// following loop to eliminate 'chhotee ee kee maatraa' on half-letters as a result of above transformation.

var position_of_wrong_ee = modified_substring.indexOf( "ि्" ) 

while ( position_of_wrong_ee != -1 )  //while-03

{
var consonent_next_to_wrong_ee = modified_substring.charAt( position_of_wrong_ee + 2 )
var character_to_be_replaced = "ि्" + consonent_next_to_wrong_ee 
modified_substring = modified_substring.replace( character_to_be_replaced , "्" + consonent_next_to_wrong_ee + "ि" ) 
position_of_wrong_ee = modified_substring.search( /ि्/ , position_of_wrong_ee + 2 ) // search for 'wrong ee' ahead of the current position. 

} // end of while-03 loop

//**************************************
// 
//**************************************
//   alert(modified_substring);
//**************************************


// Eliminating reph "Z" and putting 'half - r' at proper position for this.
set_of_matras = "अ आ इ ई उ ऊ ए ऐ ओ औ ा ि ी ु ू ृ े ै ो ौ ं : ँ ॅ" 

var position_of_R = modified_substring.indexOf( "Z" )

// alert(" 1. modified_substring = "+modified_substring );
// alert(" 2. position_of_R = "+position_of_R )

while ( position_of_R > 0 )  // while-04
{
probable_position_of_half_r = position_of_R - 1 ;

 //alert(" 3. probable_position_of_half_r = "+probable_position_of_half_r );

var character_at_probable_position_of_half_r = modified_substring.charAt( probable_position_of_half_r )

 //alert(" 4. character_at_probable_position_of_half_r = "+character_at_probable_position_of_half_r );

//************************************************************
// trying to find non-maatra position left to current O (ie, half -r).
//************************************************************

while ( set_of_matras.match( character_at_probable_position_of_half_r ) != null )  // while-05
// some vowel maatraa or anusvaar found, move to previous character
   {   probable_position_of_half_r = probable_position_of_half_r - 1 ;
       character_at_probable_position_of_half_r = modified_substring.charAt( probable_position_of_half_r ) ;
   
     //alert(" 5. probable_position_of_half_r = "+probable_position_of_half_r );
     //alert(" 6. character_at_probable_position_of_half_r = "+character_at_probable_position_of_half_r );
   } // end of while-05

//************************************************************
// check if the previous character to the present character is a halant
//************************************************************
   var previous_to_position_of_half_r = probable_position_of_half_r - 1 ;
 //alert(" 7. previous_to_position_of_half_r = "+previous_to_position_of_half_r );

   if (previous_to_position_of_half_r > 0)  // if-03
   {  var character_previous_to_position_of_half_r = modified_substring.charAt( previous_to_position_of_half_r )
    //alert(" 8. character_previous_to_position_of_half_r = "+character_previous_to_position_of_half_r );

      while ("्".match( character_previous_to_position_of_half_r ) != null ) // while-06
//    halant found, move to previous character
      {  probable_position_of_half_r = previous_to_position_of_half_r - 1 ;
         character_at_probable_position_of_half_r = modified_substring.charAt( probable_position_of_half_r ) ;

       //alert(" 9. probable_position_of_half_r = "+probable_position_of_half_r );
       //alert("10. character_at_probable_position_of_half_r = "+character_at_probable_position_of_half_r );
       
         previous_to_position_of_half_r = probable_position_of_half_r - 1 ;
         character_previous_to_position_of_half_r = modified_substring.charAt( previous_to_position_of_half_r )

       //alert("11. previous_to_position_of_half_r = "+previous_to_position_of_half_r );
       //alert("12. character_previous_to_position_of_half_r = "+character_previous_to_position_of_half_r );
      } // end of while-06
   } // end of if-03

//************************************************************

character_to_be_replaced = modified_substring.substr ( probable_position_of_half_r , ( position_of_R - probable_position_of_half_r ) ) ;
new_replacement_string = "र्" + character_to_be_replaced ; 
character_to_be_replaced = character_to_be_replaced + "Z" ;
modified_substring = modified_substring.replace( character_to_be_replaced , new_replacement_string ) ;
position_of_R = modified_substring.indexOf( "Z" ) ;

 //alert("13. character_to_be_replaced = "+character_to_be_replaced );
 //alert("14. modified_substring = "+modified_substring );

} // end of while-04

} // end of IF  statement  meant to  supress processing of  blank  string.

//**************************************
//   alert(modified_substring);
//**************************************


} // end of the function  Replace_Symbols
 
} // end of Krutidev_to_unicode function

//*******************************************************************************
function Convert_to_Krutidev_010()
{
setTimer();

var array_one = new Array( 
// ignore all nuktas except in ड़ and ढ़
"‘","’","“","”","(",")","{","}","=","।","?","-","µ","॰",",",".","् ", 
"०","१","२","३","४","५","६","७","८","९","x","+",";","_",

"फ़्","क़","ख़","ग़","ज़्","ज़","ड़","ढ़","फ़","य़","ऱ","ऩ",    // one-byte nukta varNas
"त्त्","त्त","क्त","दृ","कृ",

"श्व","ह्न","ह्य","हृ","ह्म","ह्र","ह्","द्द","क्ष्","क्ष","त्र्","त्र","ज्ञ",
"छ्य","ट्य","ठ्य","ड्य","ढ्य","द्य","द्व",
"श्र","ट्र","ड्र","ढ्र","छ्र","क्र","फ्र","द्र","प्र","ग्र","रु","रू",
"्र",

"ओ","औ","आ","अ","ई","इ","उ","ऊ","ऐ","ए","ऋ",

"क्","क","क्क","ख्","ख","ग्","ग","घ्","घ","ङ",
"चै","च्","च","छ","ज्","ज","झ्","झ","ञ",

"ट्ट","ट्ठ","ट","ठ","ड्ड","ड्ढ","ड","ढ","ण्","ण",  
"त्","त","थ्","थ","द्ध","द","ध्","ध","न्","न",  

"प्","प","फ्","फ","ब्","ब","भ्","भ","म्","म",
"य्","य","र","ल्","ल","ळ","व्","व", 
"श्", "श",  "ष्", "ष",  "स्",   "स",   "ह",     

"ऑ","ॉ","ो","ौ","ा","ी","ु","ू","ृ","े","ै",
"ं","ँ","ः","ॅ","ऽ","् ","्","़","/")

var array_two = new Array( 

"^","*","Þ","ß","¼","½","¿","À","¾","A","\\","&","&","Œ","]","-","~ ", 
"å","ƒ","„","…","†","‡","ˆ","‰","Š","‹","Û","$","(","&",

// "¶","d","[k","x","T","t","M+","<+","Q",";","j","u",
"¶+","d+","[k+","x+","T+","t+","M+","<+","Q+",";+","j+","u+",
"Ù","Ùk","ä","–","—",       

"Üo","à","á","â","ã","ºz","º","í","{","{k","«","=","K", 
"Nî","Vî","Bî","Mî","<î","|","}",
"J","Vª","Mª","<ªª","Nª","Ø","Ý","æ","ç","xz","#",":",
"z",

"vks","vkS","vk","v","bZ","b","m","Å",",s",",","_",

"D","d","ô","[","[k","X","x","?","?k","³", 
"pkS","P","p","N","T","t","÷",">","¥",

"ê","ë","V","B","ì","ï","M","<",".",".k",   
"R","r","F","Fk",")","n","è","èk","U","u",   

"I","i","¶","Q","C","c","H","Hk","E","e",
"¸",";","j","Y","y","G","O","o",
"'","'k","\"","\"k","L","l","g",      

"v‚","‚","ks","kS","k","h","q","w","`","s","S",
"a","¡","%","W","·","~ ","~","+","@")   // "~j"
  
//************************************************************
//Put "Enter chunk size:" line before "<textarea name= ..." if required to be used.    
//************************************************************
//Enter chunk size: <input type="text" name="chunksize" value="6000" size="7" maxsize="7" style="text-align:right"><br/><br/>
//************************************************************
// The following two characters are to be replaced through proper checking of locations:

// "र्" (reph) 
// "Z" )

// "ि"  
// "f" )


var array_one_length = array_one.length ;

var modified_substring = document.getElementById("unicode_text").value  ;

//****************************************************************************************
//  Break the long text into small bunches of max. max_text_size  characters each.
//****************************************************************************************
    var text_size = document.getElementById("unicode_text").value.length ;

    var processed_text = '' ;  //blank

    var sthiti1 = 0 ;  var sthiti2 = 0 ;  var chale_chalo = 1 ;
 
    var max_text_size = 6000;

   //************************************************************
   // var max_text_size = chunksize;	
   // alert(max_text_size);
   //************************************************************

    while ( chale_chalo == 1 ) 
    {
     sthiti1 = sthiti2 ;

     if ( sthiti2 < ( text_size - max_text_size ) )  
     { 
      sthiti2 +=  max_text_size ;
      while (document.getElementById("unicode_text").value.charAt ( sthiti2 ) != ' ') {sthiti2--;}
     } 
     else  { sthiti2 = text_size  ;  chale_chalo = 0 }

     var modified_substring = document.getElementById("unicode_text").value.substring ( sthiti1, sthiti2 )  ;

    // ---- BUG FIX: only Hindi Unicode text should go through the symbol
    // mapping below. English words / numbers embedded in the input were
    // getting scrambled because some Devanagari-mapping symbols happen to
    // collide with plain ASCII characters (e.g. "x", "+", ".", ","). So we
    // temporarily pull out English/number runs, convert only what's left,
    // then put the original English text back untouched. ----
    var english_runs = [];
    modified_substring = modified_substring.replace( /[A-Za-z0-9]+(?:[.,;:!?'"_\-@\/]?[A-Za-z0-9]+)*[.,;:!?]?/g, function(match){
      english_runs.push(match);
      return "\u0001" + (english_runs.length - 1) + "\u0002";
    });

    Replace_Symbols( ) ;

    // restore the protected English/number text exactly as typed
    modified_substring = modified_substring.replace( /\u0001(\d+)\u0002/g, function(_, idx){
      return english_runs[Number(idx)];
    });

    processed_text += modified_substring ;

//****************************************************************************************
//  Breaking part code over
//****************************************************************************************
//  processed_text = processed_text.replace( /mangal/g , "Krutidev010" ) ;   

    document.getElementById("legacy_text").value = processed_text  ;
   }


//**************************************************

function Replace_Symbols( )
   {


    // if string to be converted is non-blank then no need of any processing.
    if (modified_substring != "" )  
       {

// first replace the two-byte nukta_varNa with corresponding one-byte nukta varNas.

modified_substring = modified_substring.replace ( /त्र्य/g , "«य" )  ; 
modified_substring = modified_substring.replace ( /श्र्य/g , "Ü‍‍zय" )  ; 

modified_substring = modified_substring.replace ( /क़/ , "क़" )  ; 
modified_substring = modified_substring.replace ( /ख़‌/g , "ख़" )  ;
modified_substring = modified_substring.replace ( /ग़/g , "ग़" )  ;
modified_substring = modified_substring.replace ( /ज़/g , "ज़" )  ;
modified_substring = modified_substring.replace ( /ड़/g , "ड़" )  ;
modified_substring = modified_substring.replace ( /ढ़/g , "ढ़" )  ;
modified_substring = modified_substring.replace ( /ऩ/g , "ऩ" )  ;
modified_substring = modified_substring.replace ( /फ़/g , "फ़" )  ;
modified_substring = modified_substring.replace ( /य़/g , "य़" )  ;
modified_substring = modified_substring.replace ( /ऱ/g , "ऱ" )  ;


        // code for replacing "ि" (chhotee ee kii maatraa) with "f"  and correcting its position too.
        
        var position_of_f = modified_substring.indexOf( "ि" )  ;
         while ( position_of_f != -1 )  //while-02
           {
            var character_left_to_f = modified_substring.charAt( position_of_f - 1 )  ;
            modified_substring = modified_substring.replace( character_left_to_f + "ि" ,  "f" + character_left_to_f )  ;

            position_of_f = position_of_f - 1  ;

            while (( modified_substring.charAt( position_of_f - 1 ) == "्" )  &  ( position_of_f != 0  ) )
               {
                var string_to_be_replaced = modified_substring.charAt( position_of_f - 2 ) + "्"  ;
                  modified_substring = modified_substring.replace( string_to_be_replaced + "f", "f" + string_to_be_replaced ) ;

                position_of_f = position_of_f - 2  ;
               }
            position_of_f = modified_substring.search( /ि/ , position_of_f + 1 ) ; // search for f ahead of the current position.

           } // end of while-02 loop
   //************************************************************     
   //     modified_substring = modified_substring.replace( /fर्/g , "£"  )  ;
   //************************************************************     
        // Eliminating "र्" and putting  Z  at proper position for this.

       set_of_matras = "ािीुूृेैोौं:ँॅ" 

modified_substring += '  '    ;  // add two spaces after the string to avoid UNDEFINED char in the following code.

       var position_of_half_R = modified_substring.indexOf( "र्" ) ;
    //  alert(" 21. position_of_half_R = " + position_of_half_R);

//************************************************************************************
   while ( position_of_half_R > 0  )  // while-03
   {
    // "र्"  is two bytes long
    var probable_position_of_Z = position_of_half_R + 2   ;  
    var character_at_probable_position_of_Z = modified_substring.charAt( probable_position_of_Z )

 // alert(" 3. probable_position_of_Z = "+probable_position_of_Z );
 // alert(" 4. character_at_probable_position_of_Z = "+character_at_probable_position_of_Z );

    // trying to find non-maatra position right to probable_position_of_Z .

    while( set_of_matras.match( character_at_probable_position_of_Z ) != null ) // while-04 
    {
     probable_position_of_Z = probable_position_of_Z + 1 ;
     character_at_probable_position_of_Z = modified_substring.charAt( probable_position_of_Z ) ;

// alert(" 5. probable_position_of_Z = "+probable_position_of_Z );
// alert(" 6. character_at_probable_position_of_Z = "+character_at_probable_position_of_Z );
    } // end of while-04
//************************************************************
// check if the next character is a halant
//************************************************************
    var right_to_position_of_Z = probable_position_of_Z + 1 ;
 // alert(" 7. right_to_position_of_Z = "+right_to_position_of_Z );

    if (right_to_position_of_Z > 0)  // if-03
    { var character_right_to_position_of_Z = modified_substring.charAt( right_to_position_of_Z )
   // alert(" 8. character_right_to_position_of_Z = "+character_right_to_position_of_Z );
//    while ("्".match( character_right_to_position_of_Z ) != null ) // while-05

      while ( character_right_to_position_of_Z == "्" ) // while-05
      {  
//       halant found, move to next character
         probable_position_of_Z = right_to_position_of_Z + 1 ;
         character_at_probable_position_of_Z = modified_substring.charAt( probable_position_of_Z ) ;

    // alert(" 9. probable_position_of_Z = "+probable_position_of_Z );
    // alert("10. character_at_probable_position_of_Z = "+character_at_probable_position_of_Z );
       
         right_to_position_of_Z = probable_position_of_Z + 1 ;
         character_right_to_position_of_Z = modified_substring.charAt( right_to_position_of_Z )

    // alert("11. right_to_position_of_Z = "+right_to_position_of_Z );
    // alert("12. character_right_to_position_of_Z = "+character_right_to_position_of_Z );
      } // end of while-05

    // alert("121. position_of_half_R = "+position_of_half_R);
    // alert("122. probable_position_of_Z = "+probable_position_of_Z);

   } // end of if-03
//************************************************************

       string_to_be_replaced = modified_substring.substr ( position_of_half_R + 2,(probable_position_of_Z - position_of_half_R)-1) ;
//************************************************************
//     check if character_right_to_position_of_Z is a space
//       if (space.match(character_right_to_position_of_Z) != null) 
//       {
//          string_to_be_replaced = string_to_be_replaced.substr(0,string_to_be_replaced.length - 1)
//        alert("13. string_to_be_replaced = "+string_to_be_replaced );
//        alert("14. string_to_be_replaced.length ="+string_to_be_replaced.length);
//       }
       modified_substring = modified_substring.replace( "र्" + string_to_be_replaced, string_to_be_replaced + "Z" ) ;

//     alert("15. string_to_be_replaced = "+string_to_be_replaced );
//     alert("16. modified_substring = "+modified_substring );
       position_of_half_R = modified_substring.indexOf( "र्" ) ;
//      alert("17. position_of_half_R = "+position_of_half_R )

   } // end of while-03
//***********************************************************
modified_substring = modified_substring.substr ( 0 , modified_substring.length - 2 )  ;



        //substitute array_two elements in place of corresponding array_one elements

        for( input_symbol_idx = 0; input_symbol_idx < array_one_length; input_symbol_idx++ )
           {
            idx = 0  ;  // index of the symbol being searched for replacement

            while (idx != -1 ) //whie-00
               {
                modified_substring = modified_substring.replace( array_one[ input_symbol_idx ] , array_two[input_symbol_idx] )
                idx = modified_substring.indexOf( array_one[input_symbol_idx] )
               } // end of while-00 loop
           } // end of for loop

        } // end of IF  statement  meant to  supress processing of  blank  string.
modified_substring = modified_substring.replace( /Zksa/g , "ksZa" ) ; 
modified_substring = modified_substring.replace( /~ Z/g , "Z~" ) ; 
modified_substring = modified_substring.replace( /Zk/g , "kZ" ) ; 
modified_substring = modified_substring.replace( /Zh/g , "Ê" ) ; 

    } // end of the function  Replace_Symbols( )


  } // end of Convert_Unicode_to_Krutidev010 function
