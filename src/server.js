import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import { exec } from 'child_process';
import rateLimit from 'express-rate-limit';
import JSON5 from 'json5';
import fastJsonParse from 'fast-json-parse';


//config
    dotenv.config();
    const app = express();
    const port = 3000;
    const limiter = rateLimit({
      windowMs: 1000, // 1 second
      max: 1, // Allow only 1 request per second
    });
    app.use(cors());
    app.use(express.json());
    //app.use('/process-text', limiter);




// Preprocess text
    const preprocessText = (text) => {
      console.log("Step 1: Preprocessing text...");
      return text.replace(/\s+/g, ' ').trim();
    };


//LLM




const firstPrompt = (text, inputWord) => {

  return `How is "${inputWord}" described in the "${text}" ? Only focus on "${inputWord}", do not summarise the whole text, stay short.`;
};



const secondPrompt = (summaryText) => {

  return `This is the text: "${summaryText}". Extract the semantically relevant entities in **valid JSON format**. Do not include too many entities, only the most relevant ones.

  For each entity, provide:
  - "name": The entity's name.
  - "description": A short definition or explanation.
  - "status": Its category or classification.
  - "relations": A list of tuples that show relationships with other entities and describe the nature of this relationship.


 **Example Output:**
  \`\`\`json
    [
      {
        "name": "car",
        "description": "A wheeled motor vehicle used for transportation...",
        "status": "transportation mode",
        "relations": [
          ["engine", "Powered by internal combustion or electric motors"],
          ["hybrid_car", "Uses both traditional and electric propulsion"]
        ]
      }
    ]
  \`\`\`


  Ensure output is in **valid JSON format**, without extra text.
  
  `;
};




  const thirdPrompt = (summaryText, entities) => {
    return `Based on the information of the "${summaryText}" organise only the ${JSON.stringify(entities.map(e => e.name))}.
    

        - organise the ${JSON.stringify(entities.map(e => e.name))} into clusters. A entity can be part of multiple clusters. A entity can be a superordinate entity for other entities. Return the cluster in the following way:
        
        \`\`\`json
          [superordinate entity 1, [list of subordinate entities]],
          [superordinate entity 2, [list of subordinate entities]]
        \`\`\`
        `;
  };


  const fourthPrompt = (summaryText, entities) => {
    return `Based on the information of the "${summaryText}" organise only the ${JSON.stringify(entities.map(e => e.name))}.
    
        - find sequences within the ${JSON.stringify(entities.map(e => e.name))} that naturally follow each other in a structured order. One element can be part of multiple sequences.

        \`\`\`json
          [sequence entity 1, sequence entity 2, sequence entity 3],
          [sequence entity 2, sequence entity 4, sequence entity 5]
        \`\`\`
        `;
  };









  async function summarize(text, inputWord) {
    try {
      console.log("summarize ...");
      
      const response = await axios.post('http://localhost:11434/api/generate', {
        model: 'deepseek-r1:7b',
        prompt: firstPrompt(text, inputWord),
        stream: false,
        temperature: 0.1
      });
  

      let answer = response.data.response
      const cleanedSummary = answer.replace(/<think>[\s\S]*?<\/think>/, '').trim();
  
      return cleanedSummary;
    } catch (error) {
      console.error("Error during entity extraction:", error);
      throw new Error("Entity extraction failed");
    }
  }




  async function extractEntities(text) {
    console.log("entities ...");

    try {      
        const response = await axios.post('http://localhost:11434/api/generate', {
            model: 'llama3.1:8b',
            prompt: secondPrompt(text),
            stream: false,
            temperature: 0.1
        });

        if (!response.data || !response.data.response) {
            throw new Error("API response structure is invalid");
        }

        console.log(response.data.response);

        try {
            const cleanedJson = extractJsonUsingRegex(response.data.response);
            if (!cleanedJson) {
                throw new Error("Extracted JSON is empty or invalid.");
            }

            console.log("Parsed JSON:", cleanedJson);
            return cleanedJson;
        } catch (error) {
            console.error("Error parsing JSON:", error.message);
        }

    } catch (error) {
        console.error("Error during entity extraction:", error);
        throw new Error("Entity extraction failed");
    }
}




  async function parents(text, ent) {
    console.log("parents ...");
    try {
      
      const response = await axios.post('http://localhost:11434/api/generate', {
        model: 'deepseek-r1:7b',
        prompt: thirdPrompt(text, ent),
        stream: false,
        temperature: 0.1
      });
  
      const cleanedFinal = extractJsonUsingRegex(response.data.response);
        if (!cleanedFinal) {
            console.error("Failed to extract valid JSON");
        }

  
      return cleanedFinal;
    } catch (error) {
      console.error("Error during entity extraction:", error);
      throw new Error("Entity extraction failed");
    }
  }





  async function sequences(text, ent) {
    console.log("sequences ...");

    try {
      
      const response = await axios.post('http://localhost:11434/api/generate', {
        model: 'deepseek-r1:7b',
        prompt: fourthPrompt(text, ent),
        stream: false,
        temperature: 0.1
      });
  
      const cleanedFinal = extractJsonUsingRegex(response.data.response);
        if (!cleanedFinal) {
            console.error("Failed to extract valid JSON");
        }

  
      return cleanedFinal;
    } catch (error) {
      console.error("Error during entity extraction:", error);
      throw new Error("Entity extraction failed");
    }
  }










  function parseEntities(responseData) {
    try {
      console.log("Parsing JSON...");
  
      // If responseData is already an object, return it
      if (typeof responseData === 'object' && responseData !== null) {
        return responseData;
      }
  
      // If it's a string, try parsing it
      const parsed = JSON5.parse(responseData.trim());
      if (parsed.entities && parsed.sequences) {
        return parsed;
      }
  
      throw new Error("Invalid JSON format.");
    } catch (error) {
      console.error("Error parsing JSON:", error);
      return { entities: [], sequences: [] };
    }
  }
  


function extractJsonUsingRegex(responseText) {
  if (typeof responseText !== "string") {
    console.error("Expected a string in extractJsonUsingRegex but got:", responseText);
    return null;
  }

  const jsonMatch = responseText.match(/```json([\s\S]*?)```/);
if (jsonMatch) {
    const jsonString = jsonMatch[1].trim();
    try {
        return JSON.parse(jsonString);
    } catch (error) {
        console.error("Error parsing JSON:", error);
        return null;
    }
} else {
    console.error("JSON block not found");
    return null;
}

}





//main
app.post('/process-text', async (req, res) => {
  console.log(`New request received at ${new Date().toISOString()}`);

  try {
    const { text, selectedInput } = req.body;
    if (!text || !selectedInput) {
      return res.status(400).json({ error: 'Text and Input Word are required' });
    }

    let cleanedText = preprocessText(text);
    console.log("input word: ", selectedInput);
    
    const summary = await summarize(cleanedText, selectedInput)
    console.log("Summary:", summary);

    const extractedEntities = await extractEntities(summary);
    console.log("extractedEntities:", extractedEntities);

    const parent = await parents(summary, extractedEntities)
    console.log("parent:", parent);


    const sequence = await sequences(summary, extractedEntities)
    console.log("sequence:", sequence);




    res.json(sequence);
  } catch (error) {
    console.error("Error processing request:", error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});




// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
